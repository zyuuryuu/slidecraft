/**
 * ooxml-geom.ts — PURE geometry for the preview extractor: group-shape child→slide coordinate
 * transforms (`<p:grpSp>` chOff/chExt → off/ext) and custGeom `<a:arcTo>` → an SVG arc. Split out of
 * template-loader.ts (already >400 lines, R1) and kept pure — string/number in, plain data out; no
 * DOM/Tauri (R2). Preview-only (the exported PPTX keeps the original group/arc geometry natively).
 */
import { EMU_PER_INCH } from "./ooxml-resolve";

const round = (n: number): number => Math.round(n * 100) / 100;

/** An affine EMU transform, per axis: slideEmu = s·localEmu + t. */
export interface Xf { sx: number; sy: number; tx: number; ty: number }
export const IDENTITY_XF: Xf = { sx: 1, sy: 1, tx: 0, ty: 0 };

/** The child→parent transform of a `<p:grpSp>` from its `<a:xfrm>` (off/ext + chOff/chExt): a child
 *  point in the group's CHILD space maps to parent space as off + (child − chOff)·(ext/chExt). */
export function parseGroupXf(grpSpPr: string): Xf | undefined {
  const xfrm = grpSpPr.match(/<a:xfrm[^>]*>[\s\S]*?<\/a:xfrm>/)?.[0];
  if (!xfrm) return undefined;
  const off = xfrm.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
  const ext = xfrm.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
  const chOff = xfrm.match(/<a:chOff x="(-?\d+)" y="(-?\d+)"/);
  const chExt = xfrm.match(/<a:chExt cx="(\d+)" cy="(\d+)"/);
  if (!off || !ext || !chOff || !chExt) return undefined;
  const sx = +ext[1] / (+chExt[1] || 1), sy = +ext[2] / (+chExt[2] || 1);
  return { sx, sy, tx: +off[1] - +chOff[1] * sx, ty: +off[2] - +chOff[2] * sy };
}

/** Compose parent∘child so a nested group's children map straight to slide space. */
export function composeXf(p: Xf, g: Xf): Xf {
  return { sx: p.sx * g.sx, sy: p.sy * g.sy, tx: p.sx * g.tx + p.tx, ty: p.sy * g.ty + p.ty };
}

/** Apply an Xf to an EMU rect (off + ext) → inches. */
export function transformRect(xf: Xf, xEmu: number, yEmu: number, cxEmu: number, cyEmu: number): { x: number; y: number; w: number; h: number } {
  return {
    x: (xf.sx * xEmu + xf.tx) / EMU_PER_INCH,
    y: (xf.sy * yEmu + xf.ty) / EMU_PER_INCH,
    w: (xf.sx * cxEmu) / EMU_PER_INCH,
    h: (xf.sy * cyEmu) / EMU_PER_INCH,
  };
}

/** The children of a `<p:grpSp>` block (as returned by `topLevelBlocks`), with the group's OWN
 *  opening/closing wrapper tags and its `<p:grpSpPr>` (own xfrm, not a child) stripped. Recursing on
 *  `grpBlock` itself (minus only grpSpPr) left the outer `<p:grpSp>…</p:grpSp>` wrapper intact, so the
 *  very next `topLevelBlocks` call re-matched the whole block as if it were its own nested child group
 *  — with grpSpPr already gone, `parseGroupXf` failed on it and the ENTIRE group's contents (every
 *  real child) were silently dropped. This is why group recursion must strip the wrapper before the
 *  caller recurses (#142). */
export function groupChildren(grpBlock: string, grpSpPr: string): string {
  const openEnd = grpBlock.indexOf(">") + 1;
  const closeStart = grpBlock.lastIndexOf("</p:grpSp>");
  return grpBlock.slice(openEnd, closeStart).replace(grpSpPr, "");
}

/** The FIRST `<tag …>…</tag>` property block in `xml`, tolerating attributes on the opening tag.
 *  PowerPoint-authored parts write `<p:spPr bwMode="auto">` / `<p:grpSpPr bwMode="auto">`; the old
 *  attribute-less literals missed those, so parseGroupXf saw no xfrm and the walker skipped ENTIRE
 *  groups (and spToDeco found no off/ext → dropped the shape) on real-world templates (#225). Only
 *  for non-self-nesting tags (spPr/grpSpPr) — a lazy match would mis-close a nestable one. */
export function propBlock(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`))?.[0];
}

/** The top-level `<tag>…</tag>` blocks in `xml`, matched with DEPTH counting so a same-tag nested
 *  inside another (a group within a group) is captured as ONE outer block — a lazy regex would
 *  mis-split it at the first inner close tag. */
export function topLevelBlocks(xml: string, tag: string): string[] {
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g");
  const close = `</${tag}>`;
  const tokens: { i: number; len: number; open: boolean }[] = [];
  for (const m of xml.matchAll(open)) tokens.push({ i: m.index ?? 0, len: m[0].length, open: true });
  for (let i = xml.indexOf(close); i !== -1; i = xml.indexOf(close, i + 1)) tokens.push({ i, len: close.length, open: false });
  tokens.sort((a, b) => a.i - b.i);
  const blocks: string[] = [];
  let depth = 0, start = -1;
  for (const t of tokens) {
    if (t.open) { if (depth === 0) start = t.i; depth++; }
    else if (depth > 0) { depth--; if (depth === 0 && start >= 0) { blocks.push(xml.slice(start, t.i + t.len)); start = -1; } }
  }
  return blocks;
}

/** custGeom `<a:arcTo wR hR stAng swAng>` → an SVG "A …" segment + the new current point. OOXML: the
 *  pen sits on an ellipse (radii wR,hR) at angle stAng, and the arc sweeps by swAng (both 60000ths of
 *  a degree). Center = cur − (wR·cosθ, hR·sinθ); end = center + (wR·cos(θ+Δ), hR·sin(θ+Δ)). */
export function arcToSvg(
  cur: { x: number; y: number }, wR: number, hR: number, stAng60k: number, swAng60k: number,
): { seg: string; end: { x: number; y: number } } {
  const rad = (a: number) => (a / 60000) * (Math.PI / 180);
  const st = rad(stAng60k), sw = rad(swAng60k);
  const cx = cur.x - wR * Math.cos(st), cy = cur.y - hR * Math.sin(st);
  const ex = cx + wR * Math.cos(st + sw), ey = cy + hR * Math.sin(st + sw);
  const large = Math.abs(swAng60k) / 60000 > 180 ? 1 : 0;
  const sweep = swAng60k > 0 ? 1 : 0;
  // Round the end point too — it becomes the pen position for the next segment, so it must match the
  // coordinates actually drawn (and it keeps float noise like cos(90°)≈6e-15 out of the path).
  const end = { x: round(ex), y: round(ey) };
  return { seg: `A${round(wR)} ${round(hR)} 0 ${large} ${sweep} ${end.x} ${end.y} `, end };
}
