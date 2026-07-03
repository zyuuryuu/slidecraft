/**
 * md-serializer.ts — Serialize DeckIR back to Markdown.
 *
 * Inverse of md-parser.ts. Used for:
 * - Exporting edited slides back to Markdown for LLM re-modification
 * - Round-trip preservation
 */

import type {
  DeckIR,
  SlideIR,
  PlaceholderContent,
  Paragraph,
  InlineSegment,
} from "./slide-schema";
import { autoSelectLayout } from "./template-loader";
import { tableToMarkdown } from "./md-table";

// ── Title layout detection ──

function isTitleLayout(layout: string): boolean {
  return layout.startsWith("Title.") || layout.startsWith("Closing.");
}

function isColumnLayout(layout: string): boolean {
  return layout.startsWith("Column.");
}

function isKpiLayout(layout: string): boolean {
  return layout.startsWith("KPI.");
}

function isProcessLayout(layout: string): boolean {
  return layout.startsWith("Process.");
}

// ── Placeholder idx → title field name (reverse of TITLE_FIELD_MAP) ──

const IDX_TO_FIELD: Record<string, string> = {
  "10": "Category",
  "11": "Date",
  "12": "Footer",
};

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

function serializeParagraphs(paragraphs: Paragraph[]): string {
  return paragraphs
    .map((p) => {
      const text = serializeSegments(p.segments);
      if (p.heading) return `### ${text}`;
      if (p.bullet) return `- ${text}`;
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

function getPlaceholderText(slide: SlideIR, idx: string): string | undefined {
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
function figureBlock(slide: SlideIR): string | null {
  if (slide.table) return tableToMarkdown(slide.table.rows);
  if (slide.diagram) return "```diagram\n" + slide.diagram.yaml + "\n```";
  if (slide.mermaidBlock) return "```mermaid\n" + slide.mermaidBlock.mermaid + "\n```";
  if (slide.code) return "```" + (slide.code.lang ?? "") + "\n" + slide.code.content + "\n```";
  return null;
}

// ── Determine separator type for multi-section layouts ──

function getSeparatorType(
  layout: string,
): "col" | "kpi" | "step" | null {
  if (isColumnLayout(layout)) return "col";
  if (isKpiLayout(layout)) return "kpi";
  if (isProcessLayout(layout)) return "step";
  return null;
}

// ── Serialize a single slide ──

function serializeSlide(
  slide: SlideIR,
  slideIndex: number,
  totalSlides: number,
): string {
  const lines: string[] = [];
  const layout =
    slide.layout === "auto"
      ? autoSelectLayout(slide, slideIndex, totalSlides)
      : slide.layout;

  // Emit the layout directive only when it was explicitly set. "auto" slides stay
  // directive-free so they round-trip as "auto" (re-resolved deterministically on
  // import) instead of being pinned to a concrete layout. `layout` (resolved) is
  // still used below to choose the serialization format.
  if (slide.layout !== "auto") {
    lines.push(`<!-- slide: ${layout} -->`);
  }

  if (isTitleLayout(layout)) {
    // Title layouts: idx 0 = title, idx 1 = subtitle, idx 10/11/12 = fields
    const title = getPlaceholderText(slide, "0");
    const subtitle = getPlaceholderText(slide, "1");
    if (title) lines.push(`# ${title}`);
    if (subtitle) lines.push(`## ${subtitle}`);
    lines.push("");

    // Fields
    for (const [idx, fieldName] of Object.entries(IDX_TO_FIELD)) {
      const text = getPlaceholderText(slide, idx);
      if (text) lines.push(`${fieldName}: ${text}`);
    }

    // A figure mis-pinned to a Title/Closing layout must still round-trip (not vanish).
    const fig = figureBlock(slide);
    if (fig) {
      lines.push("");
      lines.push(fig);
    }
  } else {
    // Content layouts: idx 15 = title, idx 16 = subtitle
    const title = getPlaceholderText(slide, "15");
    const subtitle = getPlaceholderText(slide, "16");
    if (title) lines.push(`# ${title}`);
    if (subtitle) lines.push(`> ${subtitle}`);
    lines.push("");

    // Prefer the slide's own group kind (card/step/kpi) over inferring from the layout name, so a
    // `<!-- card -->` slide round-trips as a card even before it's pinned to a card layout.
    const sepType = slide.groupKind ?? getSeparatorType(layout);

    if (sepType) {
      // Multi-section: each numbered region (column) becomes a section. A region may
      // hold TEXT or a FIGURE (diagram/mermaid) — emit the figure's fenced block in
      // its own column so text+figure COEXISTENCE round-trips (the figure sits beside
      // the bullets instead of replacing them). Iterate 1..max so column positions
      // (hence the figure's placeholderIdx) survive even with gaps/empties.
      const diagIdx = slide.diagram ? parseInt(slide.diagram.placeholderIdx) : NaN;
      const mermIdx = slide.mermaidBlock ? parseInt(slide.mermaidBlock.placeholderIdx) : NaN;
      let maxCol = 0;
      for (const p of slide.placeholders) {
        const n = parseInt(p.idx);
        if (/^\d+$/.test(p.idx) && n >= 1 && n <= 10) maxCol = Math.max(maxCol, n);
      }
      if (!Number.isNaN(diagIdx)) maxCol = Math.max(maxCol, diagIdx);
      if (!Number.isNaN(mermIdx)) maxCol = Math.max(maxCol, mermIdx);

      for (let col = 1; col <= maxCol; col++) {
        lines.push(`<!-- ${sepType} -->`);
        if (col === diagIdx) {
          lines.push("```diagram");
          lines.push(slide.diagram!.yaml);
          lines.push("```");
        } else if (col === mermIdx) {
          lines.push("```mermaid");
          lines.push(slide.mermaidBlock!.mermaid);
          lines.push("```");
        } else {
          const ph = slide.placeholders.find((p) => p.idx === String(col));
          if (ph) lines.push(serializeParagraphs(ph.paragraphs));
        }
        lines.push("");
      }

      // table / code are inherently single-body (never column-scoped). A figure slide
      // mis-resolved to a separator layout would otherwise lose them — emit if present.
      if (slide.table || slide.code) {
        const fig = figureBlock(slide);
        if (fig) { lines.push(fig); lines.push(""); }
      }
    } else {
      // Single body: idx 1
      const fig = figureBlock(slide);
      if (fig) {
        lines.push(fig);
      } else {
        const body = getPlaceholderText(slide, "1");
        if (body) lines.push(body);
      }

      // Secondary placeholders (2, 3, etc.) for non-column layouts
      for (let idx = 2; idx <= 6; idx++) {
        const text = getPlaceholderText(slide, String(idx));
        if (text) {
          lines.push("");
          lines.push(text);
        }
      }
    }
  }

  return lines.join("\n");
}

// ── Main serializer ──

export function serializeMd(deck: DeckIR): string {
  const parts: string[] = [];

  // Front matter
  if (deck.template) {
    parts.push("---");
    parts.push(`template: ${deck.template}`);
    parts.push("---");
    parts.push("");
  }

  // Slides
  for (let i = 0; i < deck.slides.length; i++) {
    if (i > 0) {
      parts.push("");
      parts.push("---");
      parts.push("");
    }
    parts.push(serializeSlide(deck.slides[i], i, deck.slides.length));
  }

  return parts.join("\n").trimEnd() + "\n";
}
