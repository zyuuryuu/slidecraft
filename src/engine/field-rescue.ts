/**
 * field-rescue.ts — #597 (#580 段 2-e): the FIXED fallback for a field row / cover Category that the
 * resolved layout has NO slot for. Before this, such a row was reported unbound (warn) and dropped
 * from the output; now it is drawn at a decided place and reported as an info (never-silent):
 *
 *   - `Category:` on a cover (ctrTitle layout) → one extra line at the END of the subtitle box
 *     (the subtitle box gets the category alone when the slide has no subtitle);
 *   - `Source:`  → a small one-line note ("出典：…", NOTE_FONT_PT) right UNDER the slide's content
 *     area — the same band a template's own 出典 slot occupies (公文書高密度: 8.5pt just below the
 *     body). A drawn text box, so it also works when a table/figure replaces the only body box;
 *   - `Takeaway:` → a bold line at the HEAD of the slide's first text body. No text body (a grouped
 *     card/KPI slide, a visual-only slide) → no rescue: the row stays unbound (warn) as before.
 *
 * Render-only: the SlideIR is never rewritten, so the row stays a row (serializer round-trip, editor
 * field map untouched) and BindingPlan.unbound still lists it — `rescued` says where it was drawn.
 * ONE planner for every consumer (R8): export (placeholder-filler), preview (SlideCard) and the
 * diagnostics (slideBindingPlan → deck-diagnostics) all call planFieldRescue on the same render map.
 * Do-no-harm: it only looks at row content that binding left unplaced, so a template that HAS the
 * slot (or a deck without rows) gets an empty plan → byte-identical output.
 *
 * Pure logic (R2). Must not import placeholder-binding (that module is upstream of visual-placement).
 */
import type { SlideIR, PlaceholderContent, Paragraph, ImageRect } from "./slide-schema";
import type { LayoutInfo, PlaceholderInfo } from "./template-loader";
import { placeholderRole, slideIdxRole } from "./template-catalog";
import { fieldSlotOf } from "./field-rows";
import { visualOccupancy, SLIDE_IN } from "./visual-placement";
import { CAPTION_H, CAPTION_COLOR } from "./image-caption";
import { escXml } from "./md-to-ooxml";

/** Note box height (inches) — one line; fits the 0.25in gap between a report body and its footer band. */
export const NOTE_H = 0.25;
/** Note font size (pt) — a footnote size (公文書's own 出典 slot is 8.5pt). */
export const NOTE_FONT_PT = 9;
/** The label the source note starts with (skipped when the value already says it). */
const SOURCE_LABEL = "出典：";

export type RescueKind = "category" | "callout" | "source";
export type RescueVia = "subtitle-tail" | "body-head" | "note";

export interface FieldRescue {
  kind: RescueKind;
  via: RescueVia;
  /** The row content (the ORIGINAL SlideIR object). */
  content: PlaceholderContent;
  /** Text routes: the layout placeholder the line was merged into. */
  phIdx?: string;
}

export interface FieldNote {
  text: string;
  rect: ImageRect;
  fontPt: number;
  color: string;
}

export interface RescuePlan {
  rescues: FieldRescue[];
  note?: FieldNote;
}

const textOf = (p: Paragraph) => p.segments.map((s) => s.text).join("").trim();
const nonBlank = (c: PlaceholderContent) => c.paragraphs.some((p) => textOf(p) !== "");
const isChrome = (ph: PlaceholderInfo) => ph.inferredFunction === "chrome";

/**
 * Plan the rescue of every unplaced Category/Source/Takeaway row of `slide` on `layout`, given the
 * render map the caller already bound (bindContentByRole / expandGroups — the export's own dispatch).
 */
export function planFieldRescue(
  slide: SlideIR,
  layout: LayoutInfo,
  bound: ReadonlyMap<string, PlaceholderContent>,
): RescuePlan {
  const phs = layout.placeholders;
  const hasCtrTitle = phs.some((p) => p.type.toLowerCase().includes("ctrtitle"));
  const placed = new Set(bound.values());
  const unplaced = (idx: string) => slide.placeholders.find((c) => c.idx === idx && !placed.has(c) && nonBlank(c));
  const phByIdx = new Map(phs.map((p) => [p.idx, p] as const));
  const originals = new Set(slide.placeholders);
  const occupied = visualOccupancy(slide, phs);
  const rescues: FieldRescue[] = [];

  // Category → the cover's subtitle box (the only cover-wide text line below the title).
  const category = hasCtrTitle ? unplaced("10") : undefined;
  const subtitlePh = phs.find((p) => placeholderRole(p) === "subtitle" && !isChrome(p));
  if (category && subtitlePh) rescues.push({ kind: "category", via: "subtitle-tail", content: category, phIdx: subtitlePh.idx });

  // Takeaway → the first TEXT body the slide's own body content landed in (not under a visual).
  const callout = unplaced("callout");
  const bodyPh = [...bound.entries()]
    .filter(([idx, c]) => originals.has(c) && !hasCtrTitle && slideIdxRole(c.idx, false) === "body" && !occupied.has(idx) && !isChrome(phByIdx.get(idx)!))
    .map(([idx]) => idx)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  if (callout && bodyPh) rescues.push({ kind: "callout", via: "body-head", content: callout, phIdx: bodyPh });

  // Source → a note under the content area (the boxes that draw body text, group cells or a visual).
  const source = unplaced("source");
  const note = source ? sourceNote(slide, phs, bound, originals, occupied, source) : undefined;
  if (source && note) rescues.push({ kind: "source", via: "note", content: source });

  return note ? { rescues, note } : { rescues };
}

function sourceNote(
  slide: SlideIR,
  phs: readonly PlaceholderInfo[],
  bound: ReadonlyMap<string, PlaceholderContent>,
  originals: ReadonlySet<PlaceholderContent>,
  occupied: ReadonlyMap<string, unknown>,
  source: PlaceholderContent,
): FieldNote | undefined {
  // A content box = one a visual occupies, or one that receives non-meta text (a body original, or a
  // group cell — group cells are copies, so they are never in `originals`). Title/subtitle/meta stay out.
  const isMetaOriginal = (c: PlaceholderContent) => originals.has(c) && slideIdxRole(c.idx, false) !== "body" && slideIdxRole(c.idx, false) !== "other";
  const contentPhs = phs.filter((p) => !isChrome(p) && !fieldSlotOf(p) && (occupied.has(p.idx) || (bound.has(p.idx) && !isMetaOriginal(bound.get(p.idx)!))));
  if (contentPhs.length === 0) return undefined;
  const boxes = contentPhs.map((p) => p.style);
  const x = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  let bottom = Math.max(...boxes.map((b) => b.y + b.h));
  // #399 an image's alt caption already sits under a body-figure image — stack the note below it.
  if (slide.image && !slide.image.behind && slide.image.alt.trim()) bottom += CAPTION_H;
  const y = Math.max(0, Math.min(bottom, SLIDE_IN.h - NOTE_H));
  const value = source.paragraphs.map(textOf).filter((t) => t !== "").join(" / ");
  const text = /^(?:出典|source\b)/i.test(value) ? value : SOURCE_LABEL + value;
  // Color: the template's text color for the content area (reads on a dark panel too), like #399's caption.
  return { text, rect: { x, y, w: right - x, h: NOTE_H }, fontPt: NOTE_FONT_PT, color: contentPhs[0].style.fontColor || CAPTION_COLOR };
}

const boldPara = (p: Paragraph): Paragraph => ({ segments: p.segments.map((s) => ({ ...s, bold: true })) });
const plainPara = (p: Paragraph): Paragraph => ({ segments: p.segments });

/** The render map with the text-route rescues merged in (copies — the bound originals are untouched).
 *  Returns `bound` itself when nothing was rescued by text, so row-less slides take no new path. */
export function applyFieldRescue(
  bound: Map<string, PlaceholderContent>,
  plan: RescuePlan,
): Map<string, PlaceholderContent> {
  const text = plan.rescues.filter((r) => r.phIdx !== undefined);
  if (text.length === 0) return bound;
  const out = new Map(bound);
  for (const r of text) {
    const idx = r.phIdx!;
    const cur = out.get(idx);
    const extra = r.content.paragraphs.filter((p) => textOf(p) !== "");
    const paragraphs = r.via === "body-head"
      ? [...extra.map(boldPara), ...(cur?.paragraphs ?? [])]
      : [...(cur?.paragraphs ?? []), ...extra.map(plainPara)];
    out.set(idx, { idx: cur?.idx ?? idx, paragraphs });
  }
  return out;
}

/** The source note as a PPTX text box. Zero insets so the text sits exactly where the preview draws it. */
export function fieldNoteShapeXml(shapeId: number, note: FieldNote): string {
  const EMU = (inches: number) => Math.round(inches * 914400);
  const r = note.rect;
  return `<p:sp>`
    + `<p:nvSpPr><p:cNvPr id="${shapeId}" name="FieldNote"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${EMU(r.x)}" y="${EMU(r.y)}"/><a:ext cx="${EMU(r.w)}" cy="${EMU(r.h)}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/>`
    + `<a:p><a:pPr algn="l"/><a:r><a:rPr lang="ja-JP" sz="${Math.round(note.fontPt * 100)}" dirty="0">`
    + `<a:solidFill><a:srgbClr val="${note.color}"/></a:solidFill></a:rPr><a:t>${escXml(note.text)}</a:t></a:r></a:p>`
    + `</p:txBody></p:sp>`;
}


const ROW_NAME: Record<RescueKind, string> = { category: "Category", callout: "Takeaway", source: "Source" };
const WHERE: Record<RescueVia, string> = {
  "subtitle-tail": "副題の末尾に 1 行足して",
  "body-head": "本文の先頭に太字の 1 行として",
  note: "内容の下に小さな出典行として",
};

/** The `field-row-rescued` (info) message for one rescue — names the row and where it was drawn. */
export function rescueMessage(r: FieldRescue, layoutName: string): string {
  return `${ROW_NAME[r.kind]}: 行の専用枠がこのレイアウト（${layoutName}）に無いため、${WHERE[r.via]}出力します（専用枠のあるテンプレではその枠に入ります）`;
}
