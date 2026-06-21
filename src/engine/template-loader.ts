/**
 * template-loader.ts — Load a PPTX template and extract layout registry.
 *
 * Reads a template PPTX (with no slides, only slideLayouts + slideMaster)
 * via JSZip and builds a LayoutInfo[] registry for use by the placeholder filler.
 */

import JSZip from "jszip";
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
  color: string; // hex without #
}

export interface LayoutInfo {
  index: number; // 1-based (slideLayout1.xml)
  name: string; // layout name from cSld
  placeholders: PlaceholderInfo[];
  decorations: DecoRect[]; // decorative shapes (backgrounds, bars, panels)
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

// ── Extract master style from titleStyle or bodyStyle XML ──

function parseMasterStyle(xml: string | undefined, fallback: MasterStyle): MasterStyle {
  if (!xml) return fallback;
  const szMatch = xml.match(/defRPr[^>]*sz="(\d+)"/);
  const boldMatch = xml.match(/defRPr[^>]*b="1"/);
  const colorMatch = xml.match(/srgbClr val="([A-Fa-f0-9]{6})"/);
  const fontMatch = xml.match(/<a:latin typeface="([^"]+)"/);
  const alignMatch = xml.match(/algn="(\w+)"/);
  // Bullet glyph from the level-1 paragraph style (buChar), or "" when buNone.
  const lvl1 = xml.match(/<a:lvl1pPr\b[\s\S]*?<\/a:lvl1pPr>/)?.[0] ?? xml;
  const buChar = lvl1.match(/<a:buChar[^>]*char="([^"]+)"/)?.[1];
  return {
    fontSize: szMatch ? parseInt(szMatch[1]) / 100 : fallback.fontSize,
    fontColor: colorMatch ? colorMatch[1] : fallback.fontColor,
    fontName: fontMatch ? fontMatch[1] : fallback.fontName,
    bold: boldMatch ? true : fallback.bold,
    align: alignMatch ? alignMatch[1] : fallback.align,
    bulletChar: buChar ?? (/<a:buNone\/>/.test(lvl1) ? "" : fallback.bulletChar),
  };
}

// ── Extract style from shape XML, merging with master defaults ──

function extractStyle(sp: string, masterTitle: MasterStyle, masterBody: MasterStyle): PlaceholderStyle {
  // Determine if this is a title-type placeholder
  const phType = sp.match(/<p:ph[^>]*type="(\w+)"/)?.[1] || "body";
  const isTitle = phType === "ctrTitle" || phType === "title";
  const master = isTitle ? masterTitle : masterBody;

  // Position and size from xfrm
  const offMatch = sp.match(/<a:off x="(\d+)" y="(\d+)"/);
  const extMatch = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"/);

  // Font info: check layout lstStyle first, then rPr, then fall back to master
  const szMatch = sp.match(/defRPr[^>]*sz="(\d+)"/) || sp.match(/<a:rPr[^>]*sz="(\d+)"/);
  const boldMatch = sp.match(/defRPr[^>]*b="1"/) || sp.match(/<a:rPr[^>]*b="1"/);
  const colorMatch = sp.match(/srgbClr val="([A-Fa-f0-9]{6})"/);
  const fontMatch = sp.match(/<a:latin typeface="([^"]+)"/);
  const alignMatch = sp.match(/<a:(?:def)?PPr[^>]*algn="(\w+)"/);

  // Bullet: shape's own buChar/buNone wins, else inherit the master's body bullet
  // (title placeholders never bullet). "" = no bullet.
  const shapeBuChar = sp.match(/<a:buChar[^>]*char="([^"]+)"/)?.[1];
  const bulletChar = shapeBuChar ?? (/<a:buNone\/>/.test(sp) ? "" : isTitle ? "" : master.bulletChar);

  return {
    x: emuToInch(offMatch?.[1]),
    y: emuToInch(offMatch?.[2]),
    w: emuToInch(extMatch?.[1]),
    h: emuToInch(extMatch?.[2]),
    fontSize: szMatch ? parseInt(szMatch[1]) / 100 : master.fontSize,
    fontColor: colorMatch ? colorMatch[1] : master.fontColor,
    fontName: fontMatch ? fontMatch[1] : master.fontName,
    bold: boldMatch ? true : master.bold,
    align: alignMatch ? alignMatch[1] : master.align,
    bulletChar,
  };
}

// ── Extract decorative rects from layout XML ──

function extractDecorations(layoutXml: string): DecoRect[] {
  const normalized = normalizeNs(layoutXml);
  const shapes = normalized.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
  const decos: DecoRect[] = [];

  for (const sp of shapes) {
    // Skip placeholder shapes
    if (sp.includes("<p:ph")) continue;

    const offMatch = sp.match(/<a:off x="(\d+)" y="(\d+)"/);
    const extMatch = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    const colorMatch = sp.match(/srgbClr val="([A-Fa-f0-9]{6})"/);

    if (offMatch && extMatch && colorMatch) {
      decos.push({
        x: emuToInch(offMatch[1]),
        y: emuToInch(offMatch[2]),
        w: emuToInch(extMatch[1]),
        h: emuToInch(extMatch[2]),
        color: colorMatch[1],
      });
    }
  }

  return decos;
}

// ── Extract placeholders from layout XML ──

function extractPlaceholders(
  layoutXml: string,
  masterTitle: MasterStyle,
  masterBody: MasterStyle,
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
    const type = typeMatch ? typeMatch[1] : "body";
    const name = nameMatch ? nameMatch[1] : "";
    const style = extractStyle(sp, masterTitle, masterBody);

    placeholders.push({ idx, type, name, shapeXml: sp, style });
  }

  return placeholders;
}

// ── Load template ──

export async function loadTemplate(
  pptxBuffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<TemplateData> {
  const zip = await JSZip.loadAsync(pptxBuffer);

  // ── Extract master styles ──
  const defaultStyle: MasterStyle = {
    fontSize: 14, fontColor: "1E293B", fontName: "Calibri", bold: false, align: "l", bulletChar: "",
  };
  const masterXml = await zip.file("ppt/slideMasters/slideMaster1.xml")?.async("string") ?? "";
  const titleStyleXml = masterXml.match(/<p:titleStyle>[\s\S]*?<\/p:titleStyle>/)?.[0];
  const bodyStyleXml = masterXml.match(/<p:bodyStyle>[\s\S]*?<\/p:bodyStyle>/)?.[0];
  const masterTitleStyle = parseMasterStyle(titleStyleXml, {
    ...defaultStyle, fontSize: 44, fontName: "Georgia", bold: true, fontColor: "FFFFFF",
  });
  const masterBodyStyle = parseMasterStyle(bodyStyleXml, defaultStyle);

  // ── Extract layouts ──
  const layouts: LayoutInfo[] = [];

  for (let i = 1; i <= 30; i++) {
    const path = `ppt/slideLayouts/slideLayout${i}.xml`;
    const file = zip.file(path);
    if (!file) break;

    const xml = await file.async("string");
    const nameMatch = xml.match(/name="([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : `Layout${i}`;
    const placeholders = extractPlaceholders(xml, masterTitleStyle, masterBodyStyle);
    const decorations = extractDecorations(xml);

    layouts.push({ index: i, name, placeholders, decorations });
  }

  const presentationXml = await zip
    .file("ppt/presentation.xml")!
    .async("string");
  const presentationRels = await zip
    .file("ppt/_rels/presentation.xml.rels")!
    .async("string");
  const contentTypes = await zip
    .file("[Content_Types].xml")!
    .async("string");

  // ── Extract master background color from theme ──
  const themeXml = await zip.file("ppt/theme/theme1.xml")?.async("string") ?? "";
  const lt1Match = themeXml.match(/<a:lt1>[\s\S]*?lastClr="([A-Fa-f0-9]{6})"/) ||
    themeXml.match(/<a:lt1>[\s\S]*?srgbClr val="([A-Fa-f0-9]{6})"/);
  const masterBgColor = lt1Match ? lt1Match[1] : "FFFFFF";

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
