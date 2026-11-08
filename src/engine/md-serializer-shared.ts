/**
 * md-serializer-shared.ts — the slide-content → Markdown emission PRIMITIVES shared by the two
 * serializer readouts: the plan-driven one (md-serializer-plan.ts, ADR-0030 stage B) and the legacy
 * template-less one (md-serializer.ts). Split from md-serializer.ts for R1. Pure logic (R2).
 */

import type { SlideIR, PlaceholderContent, Paragraph, FigureBlock } from "./slide-schema";
import { slideFigures } from "./slide-figures";
import { serializeInline } from "./md-inline";
import { tableToMarkdown } from "./md-table";
import { orderedNumbers, listItemLine } from "./list-markers";
import { FIELD_ROWS } from "./field-rows";
import { beforeAfterRole } from "./md-separators";
import { opensComment } from "./md-comments";

// ── Separator-layout detection (serializer-local; distinct from the title-namespace convention) ──

function isColumnLayout(layout: string): boolean {
  return layout.startsWith("Column.");
}

function isKpiLayout(layout: string): boolean {
  return layout.startsWith("KPI.");
}

function isProcessLayout(layout: string): boolean {
  return layout.startsWith("Process.");
}

/** Separator type for multi-section layouts (by canonical layout-name family). */
export function getSeparatorType(layout: string): "col" | "kpi" | "step" | null {
  if (isColumnLayout(layout)) return "col";
  if (isKpiLayout(layout)) return "kpi";
  if (isProcessLayout(layout)) return "step";
  return null;
}

/** The separator line opening region `col` (1-based) — the ONE marker writer for both readouts (R8):
 *  `<!-- step * -->` for a current step (#401); the #402 before/after pair writes the region's
 *  positional role (beforeAfterRole — the same mapping the overlay labels draw); every other family
 *  repeats its own word. */
export function separatorLine(sepType: string, slide: SlideIR, col: number): string {
  if (sepType === "step" && slide.currentSteps?.includes(col)) return "<!-- step * -->";
  const word = sepType === "beforeAfter" ? beforeAfterRole(col) : sepType;
  return `<!-- ${word} -->`;
}

/** The highest current-step column to keep when emitting a step band — so a starred EMPTY trailing
 *  step still round-trips (#401). 0 when nothing applies; capped at the 1..10 body-region range. */
export function maxCurrentStepCol(sepType: string, slide: SlideIR): number {
  if (sepType !== "step") return 0;
  return Math.max(0, ...(slide.currentSteps ?? []).filter((n) => n <= 10));
}

// ── Paragraphs → Markdown lines ──

/** A PLAIN paragraph's text is, trimmed, EXACTLY one complete `<!-- … -->` comment — the shape #147's
 *  comment-only-line parser strips. Escaping only this exact shape (not "≥1 comments", not partial
 *  text) is the #165 fix's whole scope — see the leading `\<` strip in md-slide-parser.ts. */
const COMMENT_ONLY_TEXT_RE = /^<!--(?:(?!-->).)*-->$/;

export function serializeParagraphs(paragraphs: Paragraph[]): string {
  const numbers = orderedNumbers(paragraphs); // `1.` items renumbered per run (#394)
  return paragraphs
    .map((p, i) => {
      const text = serializeInline(p.segments);
      if (p.heading) return `### ${text}`;
      if (p.bullet) return listItemLine(p, numbers[i], text);
      // #165: a GUI-authored comment-only PLAIN paragraph would otherwise emit a line #147's parser
      // drops on the next parse (silent text loss). Escape its leading `<` so the line survives —
      // md-slide-parser.ts strips exactly this one leading backslash back off.
      // #588: likewise a paragraph that OPENS a comment (`<!--` … unclosed) — a later `-->` paragraph would
      // close it and the parser would drop the whole run. Same predicate as the parser (md-comments, R8).
      if (COMMENT_ONLY_TEXT_RE.test(text.trim()) || opensComment(text.trim())) return `\\${text}`;
      return text;
    })
    .join("\n");
}

// ── Get placeholder text by idx ──

function getPlaceholder(
  slide: SlideIR,
  idx: string,
): PlaceholderContent | undefined {
  return slide.placeholders.find((p) => p.idx === idx);
}

export function getPlaceholderText(slide: SlideIR, idx: string): string | undefined {
  const ph = getPlaceholder(slide, idx);
  if (!ph) return undefined;
  return serializeParagraphs(ph.paragraphs);
}

// ── Column-scoped vs. single-body figures (#100 / #392) ──

const isBodyIdx = (idx: string) => /^\d+$/.test(idx) && Number(idx) >= 1 && Number(idx) <= 10;

/** The figures a separator (column) readout writes into their own column: every diagram/mermaid, plus
 *  each table that is COLUMN-SCOPED — sitting in its own region distinct from some OTHER real body
 *  region on the slide (a text placeholder, or another column figure, at a DIFFERENT idx). A table that
 *  is the slide's ONLY body content, merely (mis)pinned to a Column/KPI/Process layout NAME, is not:
 *  it must still serialize single-body (group-roundtrip.test.ts #4), else the parser would re-absorb it
 *  into a manufactured column on the next round-trip. Body-region idxs only (1-10, the range the column
 *  loops iterate) — the title/subtitle idxs ("15"/"16"/"0") never count as an "other region".
 *  Shared by both serializer readouts (R8: one calculation); the list itself comes from slideFigures. */
export function columnFigures(slide: SlideIR, all: FigureBlock[] = slideFigures(slide)): FigureBlock[] {
  const figs = all.filter((f) => f.kind === "diagram" || f.kind === "mermaid" || f.kind === "table");
  return figs.filter((f) =>
    f.kind !== "table" ||
    slide.placeholders.some((p) => isBodyIdx(p.idx) && parseInt(p.idx) !== parseInt(f.placeholderIdx)) ||
    figs.some((g) => g !== f && parseInt(g.placeholderIdx) !== parseInt(f.placeholderIdx)),
  );
}

/** Whether the slide must serialize as ONE body even on a separator layout: a code block or a body
 *  image (never column-scoped), a table that is not column-scoped, or two figures sharing one column
 *  (the parser reads one figure per column, #392). Shared by both readouts (R8). */
export function singleBodyFigure(slide: SlideIR): boolean {
  const all = slideFigures(slide); // one list, so `cols.includes(f)` compares the same objects
  const cols = columnFigures(slide, all);
  const idxs = cols.map((f) => parseInt(f.placeholderIdx));
  return (
    all.some((f) => f.kind === "code" || f.kind === "image" || (f.kind === "table" && !cols.includes(f))) ||
    new Set(idxs).size !== idxs.length
  );
}

// ── Body FIGURES (table / diagram / mermaid / code / image) → their Markdown blocks ──
// A figure is slide-level, NOT tied to the layout name. Emitting it must happen in EVERY layout branch
// (title / separator / single-body), else a figure slide mis-pinned to a Title or a Column/KPI/Process
// layout serializes to nothing (silent data loss that also blinds the AI to the figure it must preserve).

/** One figure's Markdown block (the parser reads each back into the same kind). */
export function figureMd(f: FigureBlock): string {
  switch (f.kind) {
    case "table": return tableToMarkdown(f.rows);
    case "diagram": return "```diagram\n" + f.yaml + "\n```";
    case "mermaid": return "```mermaid\n" + f.mermaid + "\n```";
    case "code": return "```" + (f.lang ?? "") + "\n" + f.content + "\n```";
    case "image": return imageLine(f);
  }
}

/** The single-body form: every body figure in slideFigures order (#392: source order), blank-line
 *  separated, or null. A BEHIND image is a backmost layer, not a body figure — it is emitted SEPARATELY
 *  (md-serializer) alongside the text/figures, never replacing them. */
export function figureBlock(slide: SlideIR): string | null {
  const blocks = slideFigures(slide).map(figureMd);
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

// ── Speaker notes (#150 / ADR-0032 D1) → `<!-- note -->` + Markdown body ──
// Notes are a slide-level tail (marker to the slide's end), independent of the layout branch —
// emitted ONCE at the single dispatch point (serializeSlide), so the plan-driven and legacy
// readouts can't disagree (R8: 一本化). Must stay the LAST emission of a slide: the parser
// consumes everything after the marker as notes, so anything after it would be swallowed.
export function notesLines(slide: SlideIR): string[] {
  if (!slide.notes?.length) return [];
  return ["", "<!-- note -->", serializeParagraphs(slide.notes)];
}

// ── Field rows (#397/#398) → `Takeaway: …` / `Source: …` lines ──
// Slide-level like notes, so emitted ONCE at the dispatch point (serializeSlide) for both readouts
// (R8). One line per paragraph — the parser stacks repeated rows back into paragraphs, so multi-line
// rows round-trip. Blank paragraphs are skipped (`Source:` with no value would re-parse as body text).
export function fieldRowLines(slide: SlideIR): string[] {
  const out: string[] = [];
  for (const { name, kind } of FIELD_ROWS) {
    const ph = getPlaceholder(slide, kind);
    for (const p of ph?.paragraphs ?? []) {
      const text = serializeInline(p.segments).trim();
      if (text) out.push(`${name}: ${text}`);
    }
  }
  return out;
}

/** The `![alt](src){…}` line for an image (shared by the body-figure and the behind-layer paths). */
export function imageLine(image: NonNullable<SlideIR["image"]>): string {
  return `![${image.alt}](${image.src})${imageAttrs(image)}`;
}

/** Serialize an image's geometry override as a `{x=…,y=…,w=…,h=…,fit=…,ar=…}` suffix (案B), or "" when
 *  the image has no override (a plain image stays `![alt](src)`). Inverse of parseImageAttrs. Numbers
 *  are rounded to 3 decimals (sub-0.001″ is below any visible tolerance) and trailing zeros trimmed. */
function imageAttrs(image: NonNullable<SlideIR["image"]>): string {
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  const parts: string[] = [];
  if (image.rect) parts.push(`x=${n(image.rect.x)}`, `y=${n(image.rect.y)}`, `w=${n(image.rect.w)}`, `h=${n(image.rect.h)}`);
  if (image.fit) parts.push(`fit=${image.fit}`);
  if (image.aspect !== undefined) parts.push(`ar=${n(image.aspect)}`);
  if (image.behind) parts.push("behind=1");
  return parts.length ? `{${parts.join(",")}}` : "";
}
