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
  } else {
    // Content layouts: idx 15 = title, idx 16 = subtitle
    const title = getPlaceholderText(slide, "15");
    const subtitle = getPlaceholderText(slide, "16");
    if (title) lines.push(`# ${title}`);
    if (subtitle) lines.push(`> ${subtitle}`);
    lines.push("");

    const sepType = getSeparatorType(layout);

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
    } else {
      // Single body: idx 1
      if (slide.table) {
        lines.push(tableToMarkdown(slide.table.rows));
      } else if (slide.diagram) {
        lines.push("```diagram");
        lines.push(slide.diagram.yaml);
        lines.push("```");
      } else if (slide.mermaidBlock) {
        lines.push("```mermaid");
        lines.push(slide.mermaidBlock.mermaid);
        lines.push("```");
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
