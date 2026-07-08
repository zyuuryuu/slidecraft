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
import { pickLayout, usesMetaIdxConvention, recoverLayoutTitle, type LayoutCatalog, type LayoutRole, type PlaceholderRole } from "./template-catalog";
import { parseColorRef, resolveColor } from "./ooxml-resolve";
import { buildRelMap, resolveBlipFillSrc, gradFillCss, backgroundImageSrc, backgroundGradientCss } from "./ooxml-fill";
import { type Xf, IDENTITY_XF, parseGroupXf, composeXf, transformRect, topLevelBlocks, arcToSvg } from "./ooxml-geom";

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
  // ADR-0025: a role resolved at load by the gated title recovery (recoverLayoutTitle). When set,
  // placeholderRole returns it verbatim — so a body-typed/mis-authored "Title" placeholder binds the
  // deck title. Only ever set to "title", and only when the layout had no title role (gate).
  resolvedRole?: PlaceholderRole;
  // Whether THIS template uses SlideCraft's idx-meta convention (idx 10/11/12→category/date/footer,
  // 15/16→title/subtitle). Stamped per-template at load (usesMetaIdxConvention). A bare third-party
  // master (no dotted names, no typed sldNum/dt/ftr meta — e.g. CX Sample) sets it false so its
  // body-typed idx-10..16 placeholders read as REAL content, not meta. Undefined ⇒ true (canonical).
  metaIdxConvention?: boolean;
}

export interface DecoRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string; // fill hex without #
  radius?: number; // corner radius in inches (roundRect / ellipse) — for a faithful preview
  border?: string; // outline color hex without # (a bordered/white card would otherwise vanish)
  prst?: string; // prstGeom preset (ellipse / triangle / rightArrow / chevron …). undefined ⇒ rect.
  path?: string; // custGeom → an SVG path drawn in a viewBox stretched to w×h (preserveAspectRatio=none)
  pathViewBox?: string; // "0 0 W H" for `path` (the custGeom path space)
  gradient?: string; // CSS linear-gradient for a <a:gradFill> shape (rect divs use it; SVG shapes fall back to `color`)
}

/** Static (non-placeholder) text on a layout/master — design labels like a cover's "日付 / 部署 /
 *  作成者". PowerPoint renders these; the preview used to drop them (they're neither placeholders nor
 *  filled decorations). */
export interface StaticText {
  text: string;
  style: PlaceholderStyle;
}

/** A picture (logo/graphic) placed on a layout/master, as a data-URI + rect (inches) so the preview
 *  can paint it. Lets a template's logo show in the WYSIWYG preview (it was dropped before). */
export interface ImageDeco {
  x: number;
  y: number;
  w: number;
  h: number;
  src: string; // data:<mime>;base64,… (self-contained; no external fetch)
}

export interface LayoutInfo {
  index: number; // 1-based (slideLayout1.xml)
  name: string; // layout name from cSld
  placeholders: PlaceholderInfo[];
  decorations: DecoRect[]; // decorative shapes (backgrounds, bars, panels)
  images: ImageDeco[]; // <p:pic> logos/graphics on the layout (data URIs)
  staticTexts: StaticText[]; // non-placeholder text boxes (design labels)
  background?: string; // resolved layout <p:bg> SOLID fill (hex, no #); undefined = inherit master bg
  backgroundImage?: string; // layout <p:bg> PICTURE fill as a data: URI (full-bleed brand background)
  backgroundGradient?: string; // layout <p:bg> GRADIENT fill as a CSS linear-gradient
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
  masterBackgroundImage?: string; // the master's OWN <p:bg> picture fill as a data: URI (base layer)
  masterBackgroundGradient?: string; // the master's OWN <p:bg> gradient fill as a CSS linear-gradient
  masterDecorations: DecoRect[]; // the master's OWN non-placeholder shapes (logos/bars) — a base layer
                                 // shown UNDER every layout (the preview never read these before)
  masterStaticTexts: StaticText[]; // the master's own static text labels (base layer)
  masterImages: ImageDeco[]; // the master's own <p:pic> logos/graphics (base layer, data URIs)
  themeColors: Record<string, string>; // scheme token → hex (bg1/bg2/tx1/tx2/accent1-6…), clrMap-resolved
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

/** The <a:rPr>/<a:defRPr> blocks that carry a shape's LEVEL-1 text run properties (size/color/bold/
 *  font): an actual paragraph run's rPr, then the lstStyle <a:lvl1pPr>'s defRPr. Scoping here is what
 *  makes the read robust: a template may author deeper lvl2-9 defaults BEFORE lvl1, so a naive
 *  "first defRPr / first color anywhere" grabs the wrong level. Returns { run, lvl1DefRPr, lvl1 }. */
function level1TextSources(sp: string): { run: string; lvl1DefRPr: string; lvl1: string } {
  const run = sp.match(/<a:rPr\b[\s\S]*?<\/a:rPr>|<a:rPr\b[^>]*\/>/)?.[0] ?? "";
  const lvl1 = sp.match(/<a:lvl1pPr\b[\s\S]*?<\/a:lvl1pPr>/)?.[0] ?? "";
  const lvl1DefRPr = lvl1.match(/<a:defRPr\b[\s\S]*?<\/a:defRPr>|<a:defRPr\b[^>]*\/>/)?.[0] ?? "";
  return { run, lvl1DefRPr, lvl1 };
}

/**
 * A shape's TEXT color. Prefer the LEVEL-1 run color (an actual run's rPr, else the lvl1pPr defRPr) —
 * scoped so a deeper lvl2-9 default or the shape's own fill can't hijack it. Falls back to the old
 * "first srgb / first scheme outside spPr" for simple shapes (master placeholders, static labels)
 * whose color isn't in a lvl1/run scope. undefined → the caller uses the master/default color.
 */
function extractTextColor(sp: string, theme: Record<string, string>): string | undefined {
  const { run, lvl1DefRPr } = level1TextSources(sp);
  const scoped = resolveColor(parseColorRef(run), { theme }) ?? resolveColor(parseColorRef(lvl1DefRPr), { theme });
  if (scoped) return scoped;
  const srgb = sp.match(/srgbClr val="([A-Fa-f0-9]{6})"/)?.[1];
  if (srgb) return srgb;
  const txScope = sp.replace(/<p:spPr>[\s\S]*?<\/p:spPr>/, ""); // exclude the shape fill/outline
  return resolveColor(parseColorRef(txScope), { theme });
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
  return bg ? resolveColor(parseColorRef(bg), { theme }) : undefined;
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

  // Font run properties: prefer the LEVEL-1 sources (actual run rPr, then lvl1pPr defRPr) so a lvl2-9
  // default authored BEFORE lvl1 can't be grabbed; then fall back to the shape's first defRPr/rPr
  // (catches a size held outside a lvl1 block), then the master. The scoped-first order is the fix;
  // the broad fallback preserves values the old code found.
  const { run, lvl1DefRPr, lvl1 } = level1TextSources(sp);
  const szMatch = run.match(/\bsz="(\d+)"/) || lvl1DefRPr.match(/\bsz="(\d+)"/) || sp.match(/<a:defRPr[^>]*\bsz="(\d+)"/) || sp.match(/<a:rPr[^>]*\bsz="(\d+)"/);
  const boldMatch = run.match(/\bb="1"/) || lvl1DefRPr.match(/\bb="1"/) || sp.match(/<a:defRPr[^>]*\bb="1"/) || sp.match(/<a:rPr[^>]*\bb="1"/);
  const textColor = extractTextColor(sp, theme);
  const fontMatch = run.match(/<a:latin typeface="([^"]+)"/) || lvl1DefRPr.match(/<a:latin typeface="([^"]+)"/) || sp.match(/<a:latin typeface="([^"]+)"/);
  // Alignment for level-1 text: a paragraph's own <a:pPr>, else the lstStyle's <a:lvl1pPr>, else
  // <a:defPPr>. Deliberately NOT lvl2-9 (deeper list levels) — templates may author lvl2-9 BEFORE
  // lvl1, so a naive "first pPr-like" match grabbed a lvl2 center align for a left subtitle. The old
  // /<a:(?:def)?PPr/ matched nothing at all → alignment was ALWAYS inherited from the master.
  const alignMatch =
    sp.match(/<a:pPr\b[^>]*algn="(\w+)"/) ||
    sp.match(/<a:lvl1pPr\b[^>]*algn="(\w+)"/) ||
    sp.match(/<a:defPPr\b[^>]*algn="(\w+)"/);

  // Bullet: the level-1 buChar/buNone wins, else inherit the master's body bullet (title placeholders
  // never bullet). "" = no bullet. Scoped to lvl1 (fall back to the whole shape when there's no lstStyle).
  const buScope = lvl1 || sp;
  const shapeBuChar = buScope.match(/<a:buChar[^>]*char="([^"]+)"/)?.[1];
  const bulletChar = shapeBuChar ?? (/<a:buNone\s*\/>/.test(buScope) ? "" : isTitle ? "" : master.bulletChar);

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

/** solidFill color (srgbClr / theme schemeClr) of a fragment, or undefined — via the shared resolver. */
function solidFillColor(fragment: string, theme: Record<string, string>): string | undefined {
  const solid = fragment.match(/<a:solidFill>[\s\S]*?<\/a:solidFill>/)?.[0];
  return solid ? resolveColor(parseColorRef(solid), { theme }) : undefined;
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
  if (prst === "roundRect") return Math.min(w, h) * 0.12;
  return undefined; // ellipse now renders as a true ellipse (prst-driven), not a px radius
}

/** Convert a shape's <a:custGeom> pathLst into an SVG path (+ its path-space viewBox), so a brand's
 *  freeform decoration renders faithfully instead of collapsing to a rectangle. Handles
 *  moveTo / lnTo / cubic|quadBezTo / arcTo / close. The pen position is tracked numerically so an
 *  arcTo (which is relative to the current point) resolves to an absolute SVG "A …" segment. */
function parseCustGeom(spPr: string): { path: string; viewBox: string } | undefined {
  const pathEl = spPr.match(/<a:custGeom>[\s\S]*?<a:path\b([^>]*)>([\s\S]*?)<\/a:path>/);
  if (!pathEl) return undefined;
  const w = pathEl[1].match(/\bw="(\d+)"/)?.[1];
  const h = pathEl[1].match(/\bh="(\d+)"/)?.[1];
  if (!w || !h || w === "0" || h === "0") return undefined;
  const pts = (s: string) => [...s.matchAll(/<a:pt x="(-?\d+)" y="(-?\d+)"\s*\/>/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  let d = "";
  let cur: { x: number; y: number } | null = null; // pen position (path-space units)
  for (const cmd of pathEl[2].match(/<a:(moveTo|lnTo|cubicBezTo|quadBezTo|arcTo|close)\b[^>]*(?:\/>|>[\s\S]*?<\/a:\1>)/g) || []) {
    const type = cmd.match(/<a:(\w+)/)?.[1];
    const p = pts(cmd);
    if (type === "moveTo" && p[0]) { d += `M${p[0].x} ${p[0].y} `; cur = p[0]; }
    else if (type === "lnTo" && p[0]) { d += `L${p[0].x} ${p[0].y} `; cur = p[0]; }
    else if (type === "cubicBezTo" && p.length >= 3) { d += `C${p[0].x} ${p[0].y} ${p[1].x} ${p[1].y} ${p[2].x} ${p[2].y} `; cur = p[2]; }
    else if (type === "quadBezTo" && p.length >= 2) { d += `Q${p[0].x} ${p[0].y} ${p[1].x} ${p[1].y} `; cur = p[1]; }
    else if (type === "arcTo" && cur) {
      const n = (a: string) => +(cmd.match(new RegExp(`\\b${a}="(-?\\d+)"`))?.[1] ?? 0);
      const arc = arcToSvg(cur, n("wR"), n("hR"), n("stAng"), n("swAng"));
      d += arc.seg; cur = arc.end;
    } else if (type === "close") d += "Z ";
  }
  return d.trim() ? { path: d.trim(), viewBox: `0 0 ${w} ${h}` } : undefined;
}

/** One panel/bar/card (<p:sp>) → a DecoRect, its off/ext mapped through `xf` (identity for a top-level
 *  shape; a group's composed transform for a child). undefined = a placeholder or a bare text box. */
function spToDeco(sp: string, theme: Record<string, string>, xf: Xf): DecoRect | undefined {
  if (sp.includes("<p:ph")) return undefined; // placeholders are rendered separately
  const spPr = sp.match(/<p:spPr>[\s\S]*?<\/p:spPr>/)?.[0] ?? "";
  const offMatch = spPr.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
  const extMatch = spPr.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
  if (!offMatch || !extMatch) return undefined;

  const fill = shapeFillColor(spPr, theme);
  const border = shapeLineColor(spPr, theme);
  // A gradient-filled panel/bar has no solidFill → scope to the fill region (before <a:ln>) so a
  // gradient LINE isn't mistaken for the fill, and keep the shape instead of dropping it (A3).
  const grad = fill ? undefined : gradFillCss(spPr.split(/<a:ln\b/)[0], theme);
  if (!fill && !border && !grad) return undefined; // a noFill text box with no outline is not decoration

  const r = transformRect(xf, +offMatch[1], +offMatch[2], +extMatch[1], +extMatch[2]);
  const prst = spPr.match(/<a:prstGeom prst="(\w+)"/)?.[1];
  const cust = !prst || prst === "custGeom" ? parseCustGeom(spPr) : undefined;
  return {
    x: r.x, y: r.y, w: r.w, h: r.h,
    color: fill ?? grad?.first ?? "FFFFFF", // gradient → first stop (SVG shapes); border-only → white
    radius: cornerRadius(spPr, r.w, r.h),
    border,
    ...(prst && prst !== "rect" && prst !== "roundRect" ? { prst } : {}),
    ...(cust ? { path: cust.path, pathViewBox: cust.viewBox } : {}),
    ...(grad ? { gradient: grad.css } : {}),
  };
}

/** One connector line (<p:cxnSp>) → a DecoRect, mapped through `xf`. A horizontal line has cy=0, so
 *  give it a visible thickness from <a:ln w>. Colored by the LINE fill, not a shape fill. */
function cxnToDeco(cx: string, theme: Record<string, string>, xf: Xf): DecoRect | undefined {
  const spPr = cx.match(/<p:spPr>[\s\S]*?<\/p:spPr>/)?.[0] ?? cx;
  const offMatch = spPr.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
  const extMatch = spPr.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
  const color = shapeLineColor(spPr, theme);
  if (!offMatch || !extMatch || !color) return undefined;
  const lnW = spPr.match(/<a:ln\b[^>]*\bw="(\d+)"/)?.[1];
  const thick = lnW ? emuToInch(lnW) : 0.02; // EMU→in (fallback ≈ 1.5px at preview scale)
  const r = transformRect(xf, +offMatch[1], +offMatch[2], +extMatch[1], +extMatch[2]);
  return { x: r.x, y: r.y, w: Math.max(r.w, thick), h: Math.max(r.h, thick), color };
}

/** Walk shapes at one nesting level: recurse into each <p:grpSp> with its composed child→slide
 *  transform (so a group's children land at their real slide positions instead of raw child-space
 *  coords — they used to be matched by the flat <p:sp> regex and mis-placed), then process the
 *  top-level <p:sp>/<p:cxnSp> left after the groups are removed. */
function walkShapes(xml: string, theme: Record<string, string>, xf: Xf, out: DecoRect[]): void {
  let rest = xml;
  for (const grp of topLevelBlocks(xml, "p:grpSp")) {
    rest = rest.replace(grp, "");
    const grpSpPr = grp.match(/<p:grpSpPr>[\s\S]*?<\/p:grpSpPr>/)?.[0] ?? "";
    const gx = parseGroupXf(grpSpPr);
    if (!gx) continue; // no child coordinate system → can't place its children reliably; skip
    walkShapes(grp.replace(grpSpPr, ""), theme, composeXf(xf, gx), out); // children minus the group's own xfrm
  }
  for (const sp of rest.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) { const d = spToDeco(sp, theme, xf); if (d) out.push(d); }
  for (const cx of rest.match(/<p:cxnSp>[\s\S]*?<\/p:cxnSp>/g) || []) { const d = cxnToDeco(cx, theme, xf); if (d) out.push(d); }
}

function extractDecorations(layoutXml: string, theme: Record<string, string>): DecoRect[] {
  const decos: DecoRect[] = [];
  walkShapes(normalizeNs(layoutXml), theme, IDENTITY_XF, decos);

  return decos;
}

/** Extract `<p:pic>` images (logos/graphics) from a layout/master part as data-URI ImageDecos, so the
 *  preview can paint them (they were dropped before → a template's logo never showed). Resolves each
 *  pic's blip through the part's .rels to the ppt/media/ bytes via the shared `resolveBlipFillSrc`,
 *  which prefers the primary blip but falls back to the `svgBlip` SVG when the primary is a non-web
 *  format (EMF/WMF/wdp) a browser can't paint (A2). `relDir` is the part's dir (e.g. "ppt/slideLayouts")
 *  so a "../media/x" target resolves. Async (reads media bytes). Safe: emits a self-contained data:
 *  URI (no external fetch); raster loads inertly, and svg in an <img> can't run script. */
async function extractImages(xml: string, relsXml: string, relDir: string, zip: JSZip): Promise<ImageDeco[]> {
  const relMap = buildRelMap(relsXml);
  const out: ImageDeco[] = [];
  for (const pic of normalizeNs(xml).match(/<p:pic>[\s\S]*?<\/p:pic>/g) || []) {
    const off = pic.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
    const ext = pic.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    if (!off || !ext) continue;
    const src = await resolveBlipFillSrc(pic, relMap, relDir, zip);
    if (!src) continue;
    out.push({ x: emuToInch(off[1]), y: emuToInch(off[2]), w: emuToInch(ext[1]), h: emuToInch(ext[2]), src });
  }
  return out;
}

/** Non-placeholder shapes that carry TEXT (design labels like a cover's "日付 / 部署 / 作成者").
 *  Their box + font resolve through the SAME extractStyle as placeholders (so inherited geometry/
 *  font/color work), and the text is the concatenated runs. */
function extractStaticTexts(
  layoutXml: string,
  masterTitle: MasterStyle,
  masterBody: MasterStyle,
  theme: Record<string, string>,
  masterGeom: Record<string, Geom>,
): StaticText[] {
  const normalized = normalizeNs(layoutXml);
  const out: StaticText[] = [];
  for (const sp of normalized.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) {
    if (sp.includes("<p:ph")) continue; // placeholders are rendered separately
    const text = (sp.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((m) => m.replace(/<\/?a:t>/g, "")).join("");
    if (!text.trim()) continue; // a pure fill shape (no text) is a decoration, not static text
    out.push({ text, style: extractStyle(sp, masterTitle, masterBody, theme, masterGeom) });
  }
  return out;
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

  // GUARDRAIL — a defective template may reuse a placeholder idx within one layout (OOXML requires
  // idx unique per layout; PowerPoint itself mis-binds duplicates). Our binding assumes uniqueness —
  // a duplicate makes buildFieldMap NON-injective (a 1:1 break). Keep the FIRST occurrence so the app
  // stays 1:1-robust on such masters; the later duplicate is dropped in-app (still inherited on
  // export). Deterministic by document order.
  const seen = new Set<string>();
  return placeholders.filter((p) => (seen.has(p.idx) ? false : (seen.add(p.idx), true)));
}

// ── Load template ──

export async function loadTemplate(
  pptxBuffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<TemplateData> {
  // Hardened against zip bombs / oversized input (the .pptx is untrusted: "Load
  // Template" or the nested template.pptx in a .scft). See [[zip-safe]].
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
    const staticTexts = extractStaticTexts(xml, masterTitleStyle, masterBodyStyle, themeColors, masterGeom);
    const background = extractBackground(xml, themeColors);
    const relsXml = (await zip.file(`ppt/slideLayouts/_rels/slideLayout${i}.xml.rels`)?.async("string")) ?? "";
    const relMap = buildRelMap(relsXml);
    const images = await extractImages(xml, relsXml, "ppt/slideLayouts", zip);
    // A full-bleed brand background can be a PICTURE or GRADIENT fill in <p:bg>, not just a solid color
    // (A1). Both are preview/HTML-only (the exported PPTX inherits <p:bg> natively from the layout).
    const backgroundImage = await backgroundImageSrc(xml, relMap, "ppt/slideLayouts", zip);
    const backgroundGradient = backgroundImage ? undefined : backgroundGradientCss(xml, themeColors);

    layouts.push({ index: i, name, placeholders, decorations, images, staticTexts, background, backgroundImage, backgroundGradient });
  }

  // Decide ONCE whether this master follows SlideCraft's idx-meta convention, and stamp every
  // placeholder so the (template-context-free) placeholderRole can honor it. A bare third-party
  // master opts out → its body-typed idx-10..16 placeholders bind as real content (CX Sample fix).
  const metaIdxConvention = usesMetaIdxConvention(layouts);
  for (const l of layouts) for (const p of l.placeholders) p.metaIdxConvention = metaIdxConvention;
  // ADR-0025: roles are now final (metaIdxConvention stamped) — run the gated title recovery per
  // layout so a body-typed/mis-authored "Title" placeholder is resolved to the title role. Gated on
  // "no title present", so title-typed (healthy) layouts are untouched.
  for (const l of layouts) recoverLayoutTitle(l.placeholders);

  const presentationXml = await readEntryString(zip, "ppt/presentation.xml", ZIP_LIMITS.xmlEntry);
  const presentationRels = await readEntryString(zip, "ppt/_rels/presentation.xml.rels", ZIP_LIMITS.xmlEntry);
  const contentTypes = await readEntryString(zip, "[Content_Types].xml", ZIP_LIMITS.xmlEntry);

  // ── Master background color ──
  // The master's OWN <p:bg> is authoritative (it resolves through the clrMap). A template can INVERT
  // the theme — CX Sample maps bg1→lt1=dark-navy while its real master bg is bg2→lt2=white — so
  // guessing from themeColors.bg1 paints inheriting content slides dark even though the master and the
  // exported PPTX are white. Read the real <p:bg> first; fall back to the theme's light slot only when
  // the master declares no background. (Layouts with their OWN <p:bg> already override this per-layout.)
  const masterBgColor = extractBackground(masterXml, themeColors) ?? themeColors.bg1 ?? themeColors.lt1 ?? "FFFFFF";
  // The master's OWN non-placeholder shapes (logos, header/footer bars) — the same extractor as the
  // layouts, run on the master. Shown as a base layer under every layout (previously never read).
  const masterDecorations = extractDecorations(masterXml, themeColors);
  const masterStaticTexts = extractStaticTexts(masterXml, masterTitleStyle, masterBodyStyle, themeColors, masterGeom);
  const masterRelsXml = (await zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels")?.async("string")) ?? "";
  const masterRelMap = buildRelMap(masterRelsXml);
  const masterImages = await extractImages(masterXml, masterRelsXml, "ppt/slideMasters", zip);
  // The master's OWN <p:bg> picture/gradient — shown as the base background under any layout that
  // doesn't declare its own (A1). Preview/HTML-only, same as masterBgColor.
  const masterBackgroundImage = await backgroundImageSrc(masterXml, masterRelMap, "ppt/slideMasters", zip);
  const masterBackgroundGradient = masterBackgroundImage ? undefined : backgroundGradientCss(masterXml, themeColors);

  return {
    layouts, zip, presentationXml, presentationRels, contentTypes,
    masterTitleStyle, masterBodyStyle, masterBgColor, masterDecorations, masterStaticTexts, masterImages,
    masterBackgroundImage, masterBackgroundGradient, themeColors,
  };
}

// ── Auto layout selection ──

// Which catalog group kinds a slide.groupKind may fill. card→card only (compare/課題対策 stays
// pin-only to avoid surprising routing; a future `<!-- compare -->` can add it here).
const GROUP_MATCH: Record<NonNullable<SlideIR["groupKind"]>, Array<"card" | "step" | "kpi" | "compare">> = {
  card: ["card"],
  step: ["step"],
  kpi: ["kpi"],
};

interface RolePick { role: LayoutRole; regions: number | undefined; fallback: string; }

/** Classify a slide → the ideal layout ROLE + body-region count (+ a canonical fallback name).
 *  Shared by autoSelectLayout (pick the single best) and suggestLayouts (rank candidates), so the
 *  auto pick and the suggestion list can never disagree about the slide's intent. */
function slideRoleRegions(slide: SlideIR, slideIndex: number, totalSlides: number): RolePick {
  const idxs = new Set(slide.placeholders.map((p) => p.idx));
  const hasTitle = idxs.has("15");
  const hasCtrTitle = idxs.has("0");
  // A diagram/mermaid/table/code/image occupies a body placeholder even though it isn't in `placeholders`.
  const visualIdx = slide.diagram?.placeholderIdx ?? slide.mermaidBlock?.placeholderIdx ?? slide.table?.placeholderIdx ?? slide.code?.placeholderIdx ?? slide.image?.placeholderIdx;
  const hasBody = idxs.has("1") || visualIdx === "1";
  const hasIdx2 = idxs.has("2") || visualIdx === "2";
  const hasIdx3 = idxs.has("3") || visualIdx === "3";
  const allText = slide.placeholders
    .flatMap((p) => p.paragraphs.flatMap((pp) => pp.segments.map((s) => s.text)))
    .join(" ")
    .toLowerCase();
  const isClosing = allText.includes("thank") || allText.includes("感謝") || allText.includes("ありがとう");

  // Index-0 slides default to a Title (cover) slide, EXCEPT a real content slide authored first (no
  // separate cover): a title WITH body (idx 15 + idx 1). The parser stores every `# X`/`## Y` in the
  // content namespace (idx 15/16) regardless of position, so a cover (`# 表紙 / ## サブ` → idx 15/16,
  // NO body) still coerces to Title here — the distinguisher is hasBody. Without this, a content slide
  // at idx 0 is read through the empty title namespace (idx 0/1) and serializes mangled. See
  // serializer-content-index0.test.ts.
  if (slideIndex === 0 && !visualIdx && !(hasTitle && hasBody)) return { role: "title", regions: undefined, fallback: LAYOUT_NAMES[0] };
  if (isClosing && slideIndex === totalSlides - 1) return { role: "closing", regions: undefined, fallback: LAYOUT_NAMES[28] };
  if (slide.code) return { role: "code", regions: 1, fallback: LAYOUT_NAMES[6] };
  if (hasTitle && hasBody && hasIdx2 && hasIdx3) return { role: "columns", regions: 3, fallback: LAYOUT_NAMES[12] };
  if (hasTitle && hasBody && hasIdx2) return { role: "columns", regions: 2, fallback: LAYOUT_NAMES[10] };
  if ((hasTitle || hasCtrTitle) && hasBody) return { role: "content", regions: 1, fallback: LAYOUT_NAMES[6] };
  if (hasTitle && !hasBody) return { role: "section", regions: undefined, fallback: LAYOUT_NAMES[3] };
  return { role: "content", regions: 1, fallback: LAYOUT_NAMES[6] };
}

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

  // Group-aware: a `slide.groupKind` slide routes to the matching GROUP layout (card→card, step→step,
  // kpi→kpi), preferring the group-count that fits (exact, then smallest overshoot). Only fires on
  // groupKind — non-grouped selection is byte-identical. Falls through when the template has no such
  // layout (degrades to columns-with-headings via the normal path below).
  if (slide.groupKind && catalog && catalog.length > 0) {
    const want = GROUP_MATCH[slide.groupKind];
    const need = slide.placeholders.filter((p) => /^[1-9]$/.test(p.idx)).length;
    const cands = catalog.filter((e) => e.groupKind && want.includes(e.groupKind) && (e.groupCount ?? 0) >= need);
    if (cands.length > 0) return [...cands].sort((a, b) => (a.groupCount! - need) - (b.groupCount! - need))[0].name;
  }

  // Classify into a semantic role + number of body regions, then resolve a concrete layout. WITH a
  // catalog we pick from what the LOADED template actually offers (template-driven); WITHOUT one we
  // fall back to the canonical layout names (so behavior is unchanged when no template is supplied).
  const { role, regions, fallback } = slideRoleRegions(slide, slideIndex, totalSlides);

  if (catalog && catalog.length > 0) {
    // Degrade gracefully if THIS template lacks the ideal role (e.g. no columns):
    // ideal role → content → any layout. Never returns a name not in the template.
    const hasImage = !!slide.image; // an image slide prefers a layout with a real picture frame
    const picked =
      pickLayout(catalog, role, regions, hasImage) ??
      pickLayout(catalog, "content", regions, hasImage) ??
      pickLayout(catalog, "content", undefined, hasImage) ??
      catalog[0];
    if (picked) return picked.name;
  }
  return fallback;
}

/**
 * Ranked layout candidates for a slide, for the editor's "Auto → X, also try:" UI. The auto-resolved
 * layout is ALWAYS first (so it matches autoSelectLayout); the rest are the best alternatives —
 * same ROLE first, then closest body-region count, then simpler/usable ones. Computed as-if the slide
 * were Auto, so a pinned slide still gets alternatives. [] when no template is loaded.
 */
export function suggestLayouts(
  slide: SlideIR,
  slideIndex: number,
  totalSlides: number,
  catalog: LayoutCatalog | undefined,
  limit = 4,
): string[] {
  if (!catalog || catalog.length === 0) return [];
  const asAuto = { ...slide, layout: "auto" };
  const chosen = autoSelectLayout(asAuto, slideIndex, totalSlides, catalog);
  const { role, regions } = slideRoleRegions(slide, slideIndex, totalSlides);
  const usableBody = (e: LayoutCatalog[number]) =>
    e.placeholders.some((p) => p.role === "body" && p.charsPerLine > 0 && p.maxLines > 0);
  const hasPictureFrame = (e: LayoutCatalog[number]) => e.placeholders.some((p) => p.role === "picture");
  const hasImage = !!slide.image;
  const fit = (e: LayoutCatalog[number]): number => {
    let s = e.role === role ? 0 : 50; // same role first
    if (regions !== undefined) s += Math.abs(e.bodyCount - regions) * 5; // then region-count fit
    s += e.name.match(/\+/g)?.length ?? 0; // prefer the simpler variant
    if (hasImage) {
      if (hasPictureFrame(e)) s -= 50; // an image slide prefers a picture-frame layout
    } else if ((role === "content" || role === "columns") && !usableBody(e)) {
      s += 200; // avoid degenerate/picture bodies for text
    }
    return s;
  };
  const rest = catalog.filter((e) => e.name !== chosen).sort((a, b) => fit(a) - fit(b)).map((e) => e.name);
  return [chosen, ...rest].slice(0, limit);
}

// ── Find layout by name ──

export function findLayout(
  tpl: TemplateData,
  name: string,
): LayoutInfo | undefined {
  return tpl.layouts.find((l) => l.name === name);
}
