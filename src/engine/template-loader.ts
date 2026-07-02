/**
 * template-loader.ts — Load a PPTX template and extract layout registry.
 *
 * Reads a template PPTX (with no slides, only slideLayouts + slideMaster)
 * via JSZip and builds a LayoutInfo[] registry for use by the placeholder filler.
 */

import JSZip from "jszip";
import { loadZipSafe, readCappedString, readEntryString, ZIP_LIMITS } from "./zip-safe";
import type { SlideIR } from "./slide-schema";
import { LAYOUT_NAMES } from "./slide-schema";
import { pickLayout, type LayoutCatalog, type LayoutRole } from "./template-catalog";

// ── Types ──

export interface PlaceholderStyle {
  x: number; // inches
  y: number;
  w: number;
  h: number;
  fontSize: number; // points
  fontColor: string; // hex without #
  fontName: string;
  bold: boolean;
  align: string; // "l", "ctr", "r"
  bulletChar: string; // bullet glyph from the master/layout; "" = no bullet
}

export interface PlaceholderInfo {
  idx: string;
  type: string; // "body", "ctrTitle", "subTitle", "sldNum", etc.
  name: string; // shape name from cNvPr
  shapeXml: string; // full normalized shape XML for cloning into slides
  style: PlaceholderStyle; // extracted position + style for preview
}

export interface DecoRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string; // fill hex without #
  radius?: number; // corner radius in inches (roundRect / ellipse) — for a faithful preview
  border?: string; // outline color hex without # (a bordered/white card would otherwise vanish)
}

export interface LayoutInfo {
  index: number; // 1-based (slideLayout1.xml)
  name: string; // layout name from cSld
  placeholders: PlaceholderInfo[];
  decorations: DecoRect[]; // decorative shapes (backgrounds, bars, panels)
  background?: string; // resolved layout <p:bg> fill (hex, no #); undefined = inherit master bg
}

export interface MasterStyle {
  fontSize: number;
  fontColor: string;
  fontName: string;
  bold: boolean;
  align: string;
  bulletChar: string; // lvl1 bullet glyph; "" = buNone / none
}

export interface TemplateData {
  layouts: LayoutInfo[];
  zip: JSZip; // retained for PPTX assembly
  presentationXml: string;
  presentationRels: string;
  contentTypes: string;
  masterTitleStyle: MasterStyle;
  masterBodyStyle: MasterStyle;
  masterBgColor: string; // hex without #, from theme bg1/lt1
}

// ── Namespace normalization ──

function normalizeNs(xml: string): string {
  let r = xml;
  // Map all ns0-ns9 prefixes. Detect which maps to which namespace.
  // Common: ns0 = presentationml (p:), ns1/ns2/ns3/ns4 = drawingml (a:)
  // We normalize everything to p: and a:
  for (let i = 0; i <= 9; i++) {
    const prefix = `ns${i}`;
    // Check if this prefix is used for presentationml
    if (r.includes(`xmlns:${prefix}="http://schemas.openxmlformats.org/presentationml`)) {
      r = r.split(`<${prefix}:`).join("<p:");
      r = r.split(`</${prefix}:`).join("</p:");
      r = r.replace(
        new RegExp(`xmlns:${prefix}="[^"]*"`, "g"),
        "",
      );
    }
    // Check if this prefix is used for drawingml
    if (r.includes(`xmlns:${prefix}="http://schemas.openxmlformats.org/drawingml`)) {
      r = r.split(`<${prefix}:`).join("<a:");
      r = r.split(`</${prefix}:`).join("</a:");
      r = r.replace(
        new RegExp(`xmlns:${prefix}="[^"]*"`, "g"),
        "",
      );
    }
  }
  // Fallback: if still has ns0-ns4, apply common mapping
  r = r.replace(/<ns0:/g, "<p:").replace(/<\/ns0:/g, "</p:");
  r = r.replace(/<ns1:/g, "<a:").replace(/<\/ns1:/g, "</a:");
  r = r.replace(/<ns2:/g, "<a:").replace(/<\/ns2:/g, "</a:");
  r = r.replace(/<ns3:/g, "<a:").replace(/<\/ns3:/g, "</a:");
  r = r.replace(/<ns4:/g, "<a:").replace(/<\/ns4:/g, "</a:");
  return r;
}

// ── EMU to inches ──

const EMU_PER_INCH = 914400;
function emuToInch(emu: string | undefined): number {
  return emu ? parseInt(emu) / EMU_PER_INCH : 0;
}

// ── Theme color resolution (schemeClr → hex) ──

/**
 * token → hex from the theme clrScheme, plus the master clrMap aliases (bg1/tx1/bg2/tx2 point at
 * scheme slots). Needed because most real templates color TEXT via `schemeClr` (a theme reference),
 * not an explicit `srgbClr`. Without this, such a title/body color can't be read and falls back to
 * the master default (which for titles is WHITE) → a white-on-white, invisible title in the preview.
 */
function buildThemeColors(themeXml: string, masterXml: string): Record<string, string> {
  const scheme = themeXml.match(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/)?.[0] ?? "";
  const colors: Record<string, string> = {};
  for (const m of scheme.matchAll(/<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>([\s\S]*?)<\/a:\1>/g)) {
    const hex = m[2].match(/lastClr="([A-Fa-f0-9]{6})"/)?.[1] ?? m[2].match(/srgbClr val="([A-Fa-f0-9]{6})"/)?.[1];
    if (hex) colors[m[1]] = hex.toUpperCase();
  }
  const clrMap = masterXml.match(/<p:clrMap\b[^>]*\/>/)?.[0] ?? "";
  for (const alias of ["bg1", "tx1", "bg2", "tx2"]) {
    const slot = clrMap.match(new RegExp(`\\b${alias}="(\\w+)"`))?.[1];
    if (slot && colors[slot]) colors[alias] = colors[slot];
  }
  return colors;
}

/**
 * A shape's TEXT color: an explicit srgbClr wins (canonical bakes these — unchanged); else a theme
 * `schemeClr` resolved via the clrScheme, read from the TEXT region only (the `<p:spPr>` fill/outline
 * is excluded so an accent-filled box doesn't hijack the text color); else undefined → the caller
 * falls back to the master/default color.
 */
function extractTextColor(sp: string, theme: Record<string, string>): string | undefined {
  const srgb = sp.match(/srgbClr val="([A-Fa-f0-9]{6})"/)?.[1];
  if (srgb) return srgb;
  const txScope = sp.replace(/<p:spPr>[\s\S]*?<\/p:spPr>/, "");
  const token = txScope.match(/schemeClr val="(\w+)"/)?.[1];
  return token ? theme[token] : undefined;
}

/**
 * A layout/master's own `<p:bg>` fill as hex, or undefined (inherit). Handles the two common forms:
 * `<p:bgPr><a:solidFill>` (explicit srgbClr or a theme schemeClr) and `<p:bgRef><a:schemeClr>` (a
 * theme fill-style reference — for the standard solid style the referenced color IS the schemeClr
 * token, so resolving the token is correct). Design like a full-bleed cover panel lives HERE, not in
 * a shape, so the preview must read it to match the export.
 */
function extractBackground(xml: string, theme: Record<string, string>): string | undefined {
  const bg = xml.match(/<p:bg>[\s\S]*?<\/p:bg>/)?.[0];
  if (!bg) return undefined;
  const srgb = bg.match(/<a:srgbClr val="([A-Fa-f0-9]{6})"/)?.[1];
  if (srgb) return srgb.toUpperCase();
  const token = bg.match(/<a:schemeClr val="(\w+)"/)?.[1];
  return token ? theme[token] : undefined;
}

// ── Extract master style from titleStyle or bodyStyle XML ──

function parseMasterStyle(xml: string | undefined, fallback: MasterStyle, theme: Record<string, string>): MasterStyle {
  if (!xml) return fallback;
  const szMatch = xml.match(/defRPr[^>]*sz="(\d+)"/);
  const boldMatch = xml.match(/defRPr[^>]*b="1"/);
  const srgb = xml.match(/srgbClr val="([A-Fa-f0-9]{6})"/)?.[1];
  const schemeToken = srgb ? undefined : xml.match(/schemeClr val="(\w+)"/)?.[1];
  const fontColor = srgb ?? (schemeToken ? theme[schemeToken] : undefined) ?? fallback.fontColor;
  const fontMatch = xml.match(/<a:latin typeface="([^"]+)"/);
  const alignMatch = xml.match(/algn="(\w+)"/);
  // Bullet glyph from the level-1 paragraph style (buChar), or "" when buNone.
  const lvl1 = xml.match(/<a:lvl1pPr\b[\s\S]*?<\/a:lvl1pPr>/)?.[0] ?? xml;
  const buChar = lvl1.match(/<a:buChar[^>]*char="([^"]+)"/)?.[1];
  return {
    fontSize: szMatch ? parseInt(szMatch[1]) / 100 : fallback.fontSize,
    fontColor,
    fontName: fontMatch ? fontMatch[1] : fallback.fontName,
    bold: boldMatch ? true : fallback.bold,
    align: alignMatch ? alignMatch[1] : fallback.align,
    bulletChar: buChar ?? (/<a:buNone\/>/.test(lvl1) ? "" : fallback.bulletChar),
  };
}

// ── Master placeholder style (for inheritance) ──

interface Geom { x: number; y: number; w: number; h: number; fontSize?: number; fontColor?: string; }

/** The master's geometry + font per placeholder TYPE. A layout placeholder that omits its own xfrm
 *  inherits position/size (and, when it also omits its own font, the size/color) from the master
 *  placeholder of the SAME TYPE — the OOXML rule. Without this, footer/date/number chrome collapses
 *  to 0×0 AND picks up the generic body font (e.g. 32pt in a 0.4" box → overflow) instead of the
 *  master placeholder's real 12pt. */
function extractMasterPlaceholderGeometry(masterXml: string, theme: Record<string, string>): Record<string, Geom> {
  const out: Record<string, Geom> = {};
  for (const sp of normalizeNs(masterXml).match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) {
    const phTag = sp.match(/<p:ph([^/>]*)\/?>/);
    if (!phTag) continue;
    const type = phTag[1].match(/type="(\w+)"/)?.[1] ?? "body";
    const off = sp.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
    const ext = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    if (!off || !ext) continue;
    const sz = sp.match(/<a:(?:defRPr|rPr)[^>]*\bsz="(\d+)"/)?.[1];
    out[type] = {
      x: emuToInch(off[1]), y: emuToInch(off[2]), w: emuToInch(ext[1]), h: emuToInch(ext[2]),
      fontSize: sz ? parseInt(sz) / 100 : undefined,
      fontColor: extractTextColor(sp, theme),
    };
  }
  return out;
}

// ── Extract style from shape XML, merging with master defaults ──

function extractStyle(sp: string, masterTitle: MasterStyle, masterBody: MasterStyle, theme: Record<string, string>, masterGeom: Record<string, Geom>): PlaceholderStyle {
  // Determine if this is a title-type placeholder
  const phType = sp.match(/<p:ph[^>]*type="(\w+)"/)?.[1] || "body";
  const isTitle = phType === "ctrTitle" || phType === "title";
  const master = isTitle ? masterTitle : masterBody;

  // Position and size from xfrm; when absent, INHERIT the master placeholder's box (by type).
  const offMatch = sp.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
  const extMatch = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
  const inh = (!offMatch || !extMatch) ? (masterGeom[phType] ?? (isTitle ? masterGeom.title : undefined)) : undefined;

  // Font info: check layout lstStyle first, then rPr, then fall back to master
  const szMatch = sp.match(/defRPr[^>]*sz="(\d+)"/) || sp.match(/<a:rPr[^>]*sz="(\d+)"/);
  const boldMatch = sp.match(/defRPr[^>]*b="1"/) || sp.match(/<a:rPr[^>]*b="1"/);
  const textColor = extractTextColor(sp, theme); // srgbClr → theme schemeClr → undefined
  const fontMatch = sp.match(/<a:latin typeface="([^"]+)"/);
  const alignMatch = sp.match(/<a:(?:def)?PPr[^>]*algn="(\w+)"/);

  // Bullet: shape's own buChar/buNone wins, else inherit the master's body bullet
  // (title placeholders never bullet). "" = no bullet.
  const shapeBuChar = sp.match(/<a:buChar[^>]*char="([^"]+)"/)?.[1];
  const bulletChar = shapeBuChar ?? (/<a:buNone\/>/.test(sp) ? "" : isTitle ? "" : master.bulletChar);

  return {
    x: offMatch ? emuToInch(offMatch[1]) : (inh?.x ?? 0),
    y: offMatch ? emuToInch(offMatch[2]) : (inh?.y ?? 0),
    w: extMatch ? emuToInch(extMatch[1]) : (inh?.w ?? 0),
    h: extMatch ? emuToInch(extMatch[2]) : (inh?.h ?? 0),
    fontSize: szMatch ? parseInt(szMatch[1]) / 100 : (inh?.fontSize ?? master.fontSize),
    fontColor: textColor ?? inh?.fontColor ?? master.fontColor,
    fontName: fontMatch ? fontMatch[1] : master.fontName,
    bold: boldMatch ? true : master.bold,
    align: alignMatch ? alignMatch[1] : master.align,
    bulletChar,
  };
}

// ── Extract decorative rects from layout XML ──

/** solidFill color (srgbClr / theme schemeClr) of a fragment, or undefined. */
function solidFillColor(fragment: string, theme: Record<string, string>): string | undefined {
  const solid = fragment.match(/<a:solidFill>[\s\S]*?<\/a:solidFill>/)?.[0];
  if (!solid) return undefined;
  const srgb = solid.match(/<a:srgbClr val="([A-Fa-f0-9]{6})"/)?.[1];
  if (srgb) return srgb.toUpperCase();
  const token = solid.match(/<a:schemeClr val="(\w+)"/)?.[1];
  return token ? theme[token] : undefined;
}

/** The shape's OWN fill color — scoped to the fill region BEFORE <a:ln>, so a noFill shape's LINE
 *  color (or a text run's color) is never mistaken for the fill. undefined = noFill / no fill. */
function shapeFillColor(spPr: string, theme: Record<string, string>): string | undefined {
  const fillRegion = spPr.split(/<a:ln\b/)[0];
  if (/<a:noFill\s*\/>/.test(fillRegion)) return undefined;
  return solidFillColor(fillRegion, theme);
}

/** The shape's outline color (inside <a:ln>), or undefined for noFill / no line. */
function shapeLineColor(spPr: string, theme: Record<string, string>): string | undefined {
  const ln = spPr.match(/<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/)?.[0];
  if (!ln) return undefined;
  return solidFillColor(ln, theme);
}

/** Corner radius (inches) for the preview: ellipse → half the min side; roundRect → ~12% of it. */
function cornerRadius(spPr: string, w: number, h: number): number | undefined {
  const prst = spPr.match(/<a:prstGeom prst="(\w+)"/)?.[1];
  if (prst === "ellipse") return Math.min(w, h) / 2;
  if (prst === "roundRect") return Math.min(w, h) * 0.12;
  return undefined;
}

function extractDecorations(layoutXml: string, theme: Record<string, string>): DecoRect[] {
  const normalized = normalizeNs(layoutXml);
  const decos: DecoRect[] = [];

  // ── Panels / bars / cards (<p:sp>) ──
  for (const sp of normalized.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) {
    if (sp.includes("<p:ph")) continue; // placeholders are rendered separately
    const spPr = sp.match(/<p:spPr>[\s\S]*?<\/p:spPr>/)?.[0] ?? "";
    const offMatch = spPr.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
    const extMatch = spPr.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    if (!offMatch || !extMatch) continue;

    const fill = shapeFillColor(spPr, theme);
    const border = shapeLineColor(spPr, theme);
    if (!fill && !border) continue; // a noFill text box with no outline is not decoration

    const w = emuToInch(extMatch[1]);
    const h = emuToInch(extMatch[2]);
    decos.push({
      x: emuToInch(offMatch[1]),
      y: emuToInch(offMatch[2]),
      w,
      h,
      color: fill ?? "FFFFFF", // border-only card → white fill so its outline still frames content
      radius: cornerRadius(spPr, w, h),
      border,
    });
  }

  // ── Connector lines (<p:cxnSp>) — title/footer rules etc. A horizontal line has cy=0, so give it
  // a visible thickness from <a:ln w>. Colored by the LINE fill, not a shape fill. ──
  for (const cx of normalized.match(/<p:cxnSp>[\s\S]*?<\/p:cxnSp>/g) || []) {
    const spPr = cx.match(/<p:spPr>[\s\S]*?<\/p:spPr>/)?.[0] ?? cx;
    const offMatch = spPr.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
    const extMatch = spPr.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    const color = shapeLineColor(spPr, theme);
    if (!offMatch || !extMatch || !color) continue;
    const lnW = spPr.match(/<a:ln\b[^>]*\bw="(\d+)"/)?.[1];
    const thick = lnW ? emuToInch(lnW) : 0.02; // EMU→in (fallback ≈ 1.5px at preview scale)
    decos.push({
      x: emuToInch(offMatch[1]),
      y: emuToInch(offMatch[2]),
      w: Math.max(emuToInch(extMatch[1]), thick),
      h: Math.max(emuToInch(extMatch[2]), thick),
      color,
    });
  }

  return decos;
}

// ── Extract placeholders from layout XML ──

function extractPlaceholders(
  layoutXml: string,
  masterTitle: MasterStyle,
  masterBody: MasterStyle,
  theme: Record<string, string>,
  masterGeom: Record<string, Geom>,
): PlaceholderInfo[] {
  const normalized = normalizeNs(layoutXml);
  const shapes = normalized.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
  const placeholders: PlaceholderInfo[] = [];

  for (const sp of shapes) {
    const phTag = sp.match(/<p:ph([^/]*?)\/?>/)
    if (!phTag) continue; // decorative shape, skip

    const attrs = phTag[1];
    const idxMatch = attrs.match(/idx="(\d+)"/);
    const typeMatch = attrs.match(/type="(\w+)"/);
    const nameMatch = sp.match(/cNvPr[^>]*name="([^"]*)"/);

    const idx = idxMatch ? idxMatch[1] : "0";
    // A typeless <p:ph> stays "" (a sentinel) — do NOT fabricate "body". Defaulting to
    // "body" erased the title/subtitle distinction and dropped content on masters whose
    // placeholders omit type (see placeholderRole's recovery tiers + assessTemplateHealth).
    const type = typeMatch ? typeMatch[1] : "";
    const name = nameMatch ? nameMatch[1] : "";
    const style = extractStyle(sp, masterTitle, masterBody, theme, masterGeom);

    placeholders.push({ idx, type, name, shapeXml: sp, style });
  }

  return placeholders;
}

// ── Load template ──

export async function loadTemplate(
  pptxBuffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<TemplateData> {
  // Hardened against zip bombs / oversized input (the .pptx is untrusted: "Load
  // Template" or the nested template.pptx in a .slidecraft). See [[zip-safe]].
  const zip = await loadZipSafe(pptxBuffer, { maxInputBytes: ZIP_LIMITS.templatePptx });

  // ── Extract master styles ──
  const defaultStyle: MasterStyle = {
    fontSize: 14, fontColor: "1E293B", fontName: "Calibri", bold: false, align: "l", bulletChar: "",
  };
  const masterXml = await readEntryString(zip, "ppt/slideMasters/slideMaster1.xml", ZIP_LIMITS.xmlEntry);
  // Theme colors first — master + placeholder text may color via `schemeClr` (a theme reference),
  // which we resolve to hex so a theme-colored title isn't lost to the white master fallback.
  const themeXml = await readEntryString(zip, "ppt/theme/theme1.xml", ZIP_LIMITS.xmlEntry);
  const themeColors = buildThemeColors(themeXml, masterXml);
  const titleStyleXml = masterXml.match(/<p:titleStyle>[\s\S]*?<\/p:titleStyle>/)?.[0];
  const bodyStyleXml = masterXml.match(/<p:bodyStyle>[\s\S]*?<\/p:bodyStyle>/)?.[0];
  const masterTitleStyle = parseMasterStyle(titleStyleXml, {
    ...defaultStyle, fontSize: 44, fontName: "Georgia", bold: true, fontColor: "FFFFFF",
  }, themeColors);
  const masterBodyStyle = parseMasterStyle(bodyStyleXml, defaultStyle, themeColors);
  const masterGeom = extractMasterPlaceholderGeometry(masterXml, themeColors); // inherited geometry + font

  // ── Extract layouts ──
  const layouts: LayoutInfo[] = [];

  // Enumerate the slideLayout parts that ACTUALLY exist, sorted by number. Do NOT assume contiguous
  // numbering: some authoring tools (and Claude-generated templates) leave GAPS (e.g. 1-6,8,12-17),
  // and the old "break on the first missing number" loop silently dropped every layout after the
  // first gap (here 7 of 13). `index` must stay the real file number — buildSlideRels references
  // ../slideLayouts/slideLayout${index}.xml.
  const layoutIndices = Object.keys(zip.files)
    .map((p) => p.match(/^ppt\/slideLayouts\/slideLayout(\d+)\.xml$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => parseInt(m[1]))
    .sort((a, b) => a - b);
  for (const i of layoutIndices) {
    const file = zip.file(`ppt/slideLayouts/slideLayout${i}.xml`);
    if (!file) continue;

    const xml = await readCappedString(file, ZIP_LIMITS.xmlEntry);
    const nameMatch = xml.match(/name="([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : `Layout${i}`;
    const placeholders = extractPlaceholders(xml, masterTitleStyle, masterBodyStyle, themeColors, masterGeom);
    const decorations = extractDecorations(xml, themeColors);
    const background = extractBackground(xml, themeColors);

    layouts.push({ index: i, name, placeholders, decorations, background });
  }

  const presentationXml = await readEntryString(zip, "ppt/presentation.xml", ZIP_LIMITS.xmlEntry);
  const presentationRels = await readEntryString(zip, "ppt/_rels/presentation.xml.rels", ZIP_LIMITS.xmlEntry);
  const contentTypes = await readEntryString(zip, "[Content_Types].xml", ZIP_LIMITS.xmlEntry);

  // ── Master background color (bg1 via the clrMap, else the theme lt1) ──
  const masterBgColor = themeColors.bg1 ?? themeColors.lt1 ?? "FFFFFF";

  return {
    layouts, zip, presentationXml, presentationRels, contentTypes,
    masterTitleStyle, masterBodyStyle, masterBgColor,
  };
}

// ── Auto layout selection ──

export function autoSelectLayout(
  slide: SlideIR,
  slideIndex: number,
  totalSlides: number,
  catalog?: LayoutCatalog,
): string {
  // An explicit layout name is honored only if THIS template actually has it.
  // A deck pinned to ANOTHER template's names (e.g. canonical names loaded onto a
  // different master) degrades like "auto" below instead of crashing the renderer.
  if (slide.layout !== "auto") {
    if (!catalog || catalog.some((e) => e.name === slide.layout)) {
      return slide.layout;
    }
  }

  const idxs = new Set(slide.placeholders.map((p) => p.idx));
  const hasTitle = idxs.has("15");
  const hasCtrTitle = idxs.has("0");
  // A diagram/mermaid occupies a body placeholder even though it isn't in
  // `placeholders`. It lands at idx 1 (solo → Content) or idx 2 (beside body
  // bullets → 2-column), so count it toward whichever region it targets.
  const visualIdx = slide.diagram?.placeholderIdx ?? slide.mermaidBlock?.placeholderIdx ?? slide.table?.placeholderIdx;
  const hasBody = idxs.has("1") || visualIdx === "1";
  const hasIdx2 = idxs.has("2") || visualIdx === "2";
  const hasIdx3 = idxs.has("3") || visualIdx === "3";

  // Check for closing keywords
  const allText = slide.placeholders
    .flatMap((p) => p.paragraphs.flatMap((pp) => pp.segments.map((s) => s.text)))
    .join(" ")
    .toLowerCase();
  const isClosing =
    allText.includes("thank") || allText.includes("感謝") || allText.includes("ありがとう");

  // Classify into a semantic role + number of body regions, then resolve a
  // concrete layout. WITH a catalog we pick from what the LOADED template
  // actually offers (template-driven); WITHOUT one we fall back to the canonical
  // layout names (so behavior is unchanged when no template is supplied).
  let role: LayoutRole;
  let regions: number | undefined;
  let fallback: string;
  if (slideIndex === 0 && !visualIdx) {
    // A first slide that's a pure title → Title. But a first slide carrying a
    // body VISUAL (diagram/table/mermaid) is content — a title layout can't hold it.
    role = "title"; regions = undefined; fallback = LAYOUT_NAMES[0];
  } else if (isClosing && slideIndex === totalSlides - 1) {
    role = "closing"; regions = undefined; fallback = LAYOUT_NAMES[28];
  } else if (hasTitle && hasBody && hasIdx2 && hasIdx3) {
    role = "columns"; regions = 3; fallback = LAYOUT_NAMES[12];
  } else if (hasTitle && hasBody && hasIdx2) {
    role = "columns"; regions = 2; fallback = LAYOUT_NAMES[10];
  } else if ((hasTitle || hasCtrTitle) && hasBody) {
    role = "content"; regions = 1; fallback = LAYOUT_NAMES[6];
  } else if (hasTitle && !hasBody) {
    role = "section"; regions = undefined; fallback = LAYOUT_NAMES[3];
  } else {
    role = "content"; regions = 1; fallback = LAYOUT_NAMES[6];
  }

  if (catalog && catalog.length > 0) {
    // Degrade gracefully if THIS template lacks the ideal role (e.g. no columns):
    // ideal role → content → any layout. Never returns a name not in the template.
    const picked =
      pickLayout(catalog, role, regions) ??
      pickLayout(catalog, "content", regions) ??
      pickLayout(catalog, "content") ??
      catalog[0];
    if (picked) return picked.name;
  }
  return fallback;
}

// ── Find layout by name ──

export function findLayout(
  tpl: TemplateData,
  name: string,
): LayoutInfo | undefined {
  return tpl.layouts.find((l) => l.name === name);
}
