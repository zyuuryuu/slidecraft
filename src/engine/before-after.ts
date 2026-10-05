/**
 * before-after.ts — the Before/After (As-is → To-be) overlay (#402): a direction ARROW between the two
 * faces and a ROLE LABEL above each, drawn on top of the compare layout a `<!-- before -->` /
 * `<!-- after -->` slide lands on (GROUP_MATCH beforeAfter → compare).
 *
 * ONE geometry for both consumers (R8, same pattern as image-caption #399): the PPTX export
 * (placeholder-filler → <p:sp> shapes) and the live/HTML preview (SlidePreview → absolutely placed
 * svg/div) both call beforeAfterOverlay, so the arrow can't sit elsewhere in preview than in the export.
 *
 * Rules:
 *   - only a groupKind "beforeAfter" slide gets an overlay — every other slide returns undefined, so
 *     compare / card / step / kpi / unmarked slides are byte-identical;
 *   - meaning is POSITIONAL: region 1 is Before, every later region After — beforeAfterRole, the same
 *     mapping the serializer writes the markers back with (groupMarkerLine);
 *   - a region is where the cell's content is actually bound: on a group layout the column of slots
 *     expandGroups fills (detectGroups), else the placeholder the binding plan assigns (a figure cell →
 *     its Nth body, like the figure itself);
 *   - the arrow sits centred in the gap between regions 1 and 2 (right-pointing side by side,
 *     down-pointing when stacked; none when they overlap or there is no 2nd region) — UNLESS the layout
 *     already draws its own direction arrow in that gap (the report family's 課題と対策 bakes a
 *     rightArrow there): the template's arrow is the master's design, so ours would only double it;
 *   - a label sits just above its region, kept below anything else above it (title/subtitle band) so it
 *     never covers the slide heading; when there is no room above (公文書高密度: the cells start right
 *     under the title band) it hangs as a tab on the region's top edge at the RIGHT end, clear of the
 *     left-aligned heading text;
 *   - colors are the THEME's accent1 / lt1 (schemeClr in PPTX — re-themes with the master). Before is
 *     an accent-outlined lt1 chip, After an lt1-outlined accent chip — both opaque, so either reads on
 *     a white canvas or on a colored heading band.
 *
 * Pure logic (R2).
 */
import type { SlideIR, ImageRect } from "./slide-schema";
import type { LayoutInfo, PlaceholderInfo, DecoRect } from "./template-loader";
import { detectGroups } from "./group-layout";
import { slideBindingPlan } from "./group-binding";
import { bodyPlaceholders, nthBody } from "./visual-placement";
import { escXml } from "./md-to-ooxml";
import { beforeAfterRole } from "./md-separators";

export const BA_LABEL_TEXT = { before: "Before", after: "After" } as const;
/** Role label box (inches) and font size (pt). */
export const BA_LABEL_W = 1.1;
export const BA_LABEL_H = 0.3;
export const BA_LABEL_FONT_PT = 12;
const LABEL_GAP = 0.06; // label ↔ region / label ↔ obstacle clearance (inches)
const ARROW_MIN = 0.3; // arrow length bounds (inches)
const ARROW_MAX = 0.8;

export interface BeforeAfterArrow { dir: "right" | "down"; rect: ImageRect; }
export interface BeforeAfterLabel { text: string; rect: ImageRect; filled: boolean; } // filled = After
export interface BeforeAfterOverlay { arrow?: BeforeAfterArrow; labels: BeforeAfterLabel[]; }

const bbox = (phs: PlaceholderInfo[]): ImageRect => {
  const x = Math.min(...phs.map((p) => p.style.x));
  const y = Math.min(...phs.map((p) => p.style.y));
  return {
    x, y,
    w: Math.max(...phs.map((p) => p.style.x + p.style.w)) - x,
    h: Math.max(...phs.map((p) => p.style.y + p.style.h)) - y,
  };
};

/** Each cell's region (in cell order) + the placeholders those regions are made of. */
function cellRegions(slide: SlideIR, layout: LayoutInfo): { regions: ImageRect[]; used: Set<string> } {
  const byIdx = new Map(layout.placeholders.map((p) => [p.idx, p] as const));
  const shape = detectGroups(layout);
  if (shape) {
    // Mirror expandGroups: content idx 1..9 in order ↔ column i (extras beyond the columns are dropped).
    const cells = slide.placeholders.filter((c) => /^[1-9]$/.test(c.idx)).length;
    const cols = shape.groups.slice(0, cells)
      .map((g) => g.flatMap((s) => { const p = byIdx.get(s.phIdx); return p ? [p] : []; }))
      .filter((c) => c.length > 0);
    return { regions: cols.map(bbox), used: new Set(shape.groups.flat().map((s) => s.phIdx)) };
  }
  const visuals = [slide.diagram, slide.mermaidBlock, slide.table, slide.code, slide.image?.behind ? undefined : slide.image]
    .flatMap((v) => (v ? [v.placeholderIdx] : []));
  const cellIdxs = [...new Set([...slide.placeholders.map((c) => c.idx), ...visuals])]
    .filter((i) => /^[1-9]$/.test(i))
    .sort((a, b) => Number(a) - Number(b));
  const plan = slideBindingPlan(slide, layout);
  const bodies = bodyPlaceholders(layout.placeholders);
  const phs = cellIdxs.flatMap((k) => {
    const bound = plan.assignments.find((a) => a.content.idx === k);
    const ph = bound ? byIdx.get(bound.placeholder.idx) : nthBody(bodies, k);
    return ph ? [ph] : [];
  });
  return { regions: phs.map((p) => bbox([p])), used: new Set(phs.map((p) => p.idx)) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Midpoint of two spans' overlap (or of their union when they don't overlap). */
const midOf = (a0: number, a1: number, b0: number, b1: number) => {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  return hi > lo ? (lo + hi) / 2 : (Math.min(a0, b0) + Math.max(a1, b1)) / 2;
};

/** A direction-arrow preset (rightArrow, downArrow, chevron, homePlate …) — a layout's OWN "→". */
const DIRECTION_PRST = /arrow$|chevron|homePlate/i;

function arrowBetween(a: ImageRect, b: ImageRect, decos: readonly DecoRect[]): BeforeAfterArrow | undefined {
  const gapX = b.x - (a.x + a.w);
  const inGap = (d: DecoRect) => {
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h / 2;
    return gapX >= -0.05
      ? cx >= a.x + a.w - 0.05 && cx <= b.x + 0.05
      : cy >= a.y + a.h - 0.05 && cy <= b.y + 0.05;
  };
  if (decos.some((d) => d.prst && DIRECTION_PRST.test(d.prst) && inGap(d))) return undefined; // the template's own arrow
  if (gapX >= -0.05) {
    const w = clamp(gapX * 0.6, ARROW_MIN, ARROW_MAX);
    const h = Math.min(w * 0.8, 0.6);
    const cx = a.x + a.w + gapX / 2;
    const cy = midOf(a.y, a.y + a.h, b.y, b.y + b.h);
    return { dir: "right", rect: { x: cx - w / 2, y: cy - h / 2, w, h } };
  }
  const gapY = b.y - (a.y + a.h);
  if (gapY >= -0.05) {
    const h = clamp(gapY * 0.6, ARROW_MIN, ARROW_MAX);
    const w = Math.min(h * 0.8, 0.6);
    const cx = midOf(a.x, a.x + a.w, b.x, b.x + b.w);
    const cy = a.y + a.h + gapY / 2;
    return { dir: "down", rect: { x: cx - w / 2, y: cy - h / 2, w, h } };
  }
  return undefined;
}

function labelAbove(r: ImageRect, obstacles: PlaceholderInfo[]): ImageRect {
  // Anything wholly above the region that the label's x-span would hit (title / subtitle band…).
  const floor = Math.max(0, ...obstacles
    .map((p) => p.style)
    .filter((s) => s.w > 0 && s.h > 0 && s.y + s.h <= r.y + 0.01 && s.x < r.x + BA_LABEL_W && s.x + s.w > r.x)
    .map((s) => s.y + s.h + LABEL_GAP));
  const above = r.y - BA_LABEL_H - LABEL_GAP;
  if (above >= floor) return { x: r.x, y: above, w: BA_LABEL_W, h: BA_LABEL_H };
  // No room above → a tab on the region's top edge, at its right end.
  const x = Math.max(r.x, r.x + r.w - BA_LABEL_W - 0.1);
  return { x, y: Math.max(floor, r.y - BA_LABEL_H / 2), w: BA_LABEL_W, h: BA_LABEL_H };
}

/** The overlay to draw for `slide` on `layout`, or undefined when the slide isn't a before/after pair. */
export function beforeAfterOverlay(slide: SlideIR, layout: LayoutInfo): BeforeAfterOverlay | undefined {
  if (slide.groupKind !== "beforeAfter") return undefined;
  const { regions, used } = cellRegions(slide, layout);
  if (regions.length === 0) return undefined;
  const obstacles = layout.placeholders.filter((p) => !used.has(p.idx));
  const labels = regions.map((r, i) => {
    const role = beforeAfterRole(i + 1);
    return { text: BA_LABEL_TEXT[role], rect: labelAbove(r, obstacles), filled: role === "after" };
  });
  const arrow = regions.length >= 2 ? arrowBetween(regions[0], regions[1], layout.decorations ?? []) : undefined;
  return { ...(arrow ? { arrow } : {}), labels };
}

/** The arrow outline, in inches relative to its rect — PowerPoint's rightArrow/downArrow DEFAULT geometry
 *  (shaft = 50% of the cross size, head length = half the short side), so preview == the PPTX preset. */
export function arrowPolygon(a: BeforeAfterArrow): Array<[number, number]> {
  const { w, h } = a.rect;
  const head = Math.min(w, h) / 2;
  return a.dir === "right"
    ? [[0, h * 0.25], [w - head, h * 0.25], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h * 0.75], [0, h * 0.75]]
    : [[w * 0.25, 0], [w * 0.75, 0], [w * 0.75, h - head], [w, h - head], [w / 2, h], [0, h - head], [w * 0.25, h - head]];
}

/** Resolved hex (no #) for the preview — the theme's accent1 and the light text that sits on it. */
export function overlayColors(themeColors: Record<string, string> | undefined): { accent: string; onAccent: string } {
  return { accent: themeColors?.accent1 ?? "4472C4", onAccent: themeColors?.lt1 ?? "FFFFFF" };
}

const EMU = (inches: number) => Math.round(inches * 914400);
const xfrm = (r: ImageRect) => `<a:xfrm><a:off x="${EMU(r.x)}" y="${EMU(r.y)}"/><a:ext cx="${EMU(r.w)}" cy="${EMU(r.h)}"/></a:xfrm>`;
const scheme = (val: string) => `<a:solidFill><a:schemeClr val="${val}"/></a:solidFill>`;

/** The overlay as PPTX shapes (arrow, then labels), ids from `firstId`. Theme colors via schemeClr. */
export function beforeAfterShapesXml(firstId: number, o: BeforeAfterOverlay): { xml: string; nextId: number } {
  let id = firstId;
  let xml = "";
  if (o.arrow) {
    xml += `<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="BeforeAfterArrow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
      + `<p:spPr>${xfrm(o.arrow.rect)}<a:prstGeom prst="${o.arrow.dir}Arrow"><a:avLst/></a:prstGeom>`
      + `${scheme("accent1")}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  }
  o.labels.forEach((l, i) => {
    xml += `<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="BeforeAfterLabel${i + 1}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
      + `<p:spPr>${xfrm(l.rect)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>`
      + `${scheme(l.filled ? "accent1" : "lt1")}<a:ln w="12700">${scheme(l.filled ? "lt1" : "accent1")}</a:ln></p:spPr>`
      + `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/>`
      + `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="${BA_LABEL_FONT_PT * 100}" b="1" dirty="0">`
      + `${scheme(l.filled ? "lt1" : "accent1")}</a:rPr><a:t>${escXml(l.text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
  });
  return { xml, nextId: id };
}
