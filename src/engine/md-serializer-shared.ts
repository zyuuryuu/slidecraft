/**
 * md-serializer-shared.ts — the slide-content → Markdown emission PRIMITIVES shared by the two
 * serializer readouts: the plan-driven one (md-serializer-plan.ts, ADR-0030 stage B) and the legacy
 * template-less one (md-serializer.ts). Split from md-serializer.ts for R1. Pure logic (R2).
 */

import type { SlideIR, PlaceholderContent, Paragraph, InlineSegment } from "./slide-schema";
import { tableToMarkdown } from "./md-table";
import { indentForLevel } from "./paragraph-nesting";

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

// ── Inline segments → Markdown text ──

function serializeSegments(segments: InlineSegment[]): string {
  return segments
    .map((seg) => {
      let text = seg.text;
      if (seg.bold) text = `**${text}**`;
      if (seg.italic) text = `*${text}*`;
      return text;
    })
    .join("");
}

// ── Paragraphs → Markdown lines ──

/** A PLAIN paragraph's text is, trimmed, EXACTLY one complete `<!-- … -->` comment — the shape #147's
 *  comment-only-line parser strips. Escaping only this exact shape (not "≥1 comments", not partial
 *  text) is the #165 fix's whole scope — see the leading `\<` strip in md-slide-parser.ts. */
const COMMENT_ONLY_TEXT_RE = /^<!--(?:(?!-->).)*-->$/;

export function serializeParagraphs(paragraphs: Paragraph[]): string {
  return paragraphs
    .map((p) => {
      const text = serializeSegments(p.segments);
      if (p.heading) return `### ${text}`;
      if (p.bullet) return `${indentForLevel(p.level ?? 0)}- ${text}`;
      // #165: a GUI-authored comment-only PLAIN paragraph would otherwise emit a line #147's parser
      // drops on the next parse (silent text loss). Escape its leading `<` so the line survives —
      // md-slide-parser.ts strips exactly this one leading backslash back off.
      if (COMMENT_ONLY_TEXT_RE.test(text.trim())) return `\\${text}`;
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

// ── Single-body FIGURE (table / diagram / mermaid / code) → its fenced Markdown block ──
// A table/diagram/mermaid/code is a slide-level, single-body figure — it is NOT tied to the layout
// name. Emitting it must happen in EVERY layout branch (title / separator / single-body), else a
// figure slide mis-pinned to a Title or a Column/KPI/Process layout serializes to nothing (silent
// data loss that also blinds the AI to the figure it must preserve). Column-scoped diagrams/mermaid
// in a separator layout are handled per-column separately; this is only the single-body form.
export function figureBlock(slide: SlideIR): string | null {
  if (slide.table) return tableToMarkdown(slide.table.rows);
  if (slide.diagram) return "```diagram\n" + slide.diagram.yaml + "\n```";
  if (slide.mermaidBlock) return "```mermaid\n" + slide.mermaidBlock.mermaid + "\n```";
  if (slide.code) return "```" + (slide.code.lang ?? "") + "\n" + slide.code.content + "\n```";
  // A BEHIND image is a backmost layer, not a body figure — it does NOT occupy the body region, so it
  // is emitted SEPARATELY (behindImageLine) alongside the text/figure, never replacing them.
  if (slide.image && !slide.image.behind) return imageLine(slide.image);
  return null;
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
