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
import { isTitleNamespace, META_FIELDS, META_IDXS, TITLE_NS, CONTENT_NS } from "./slide-roles";

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

/** The deck's display title for a tab/label = the FIRST slide's title placeholder text (canonical
 *  title namespaces: title-layout idx "0", else content-layout idx "15"), first non-empty line only.
 *  undefined for an empty / title-less deck. Pure — used to name a tab when no template name is known
 *  (e.g. an AI's `new_project`, whose `meta.templateName` is empty), instead of a bare "Untitled". */
export function deckTitle(deck: DeckIR | null): string | undefined {
  const slide = deck?.slides[0];
  if (!slide) return undefined;
  const raw = getPlaceholderText(slide, TITLE_NS.title) ?? getPlaceholderText(slide, CONTENT_NS.title);
  return raw?.split("\n").map((l) => l.trim()).find((l) => l.length > 0) || undefined;
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
  // A BEHIND image is a backmost layer, not a body figure — it does NOT occupy the body region, so it
  // is emitted SEPARATELY (behindImageLine) alongside the text/figure, never replacing them.
  if (slide.image && !slide.image.behind) return imageLine(slide.image);
  return null;
}

/** The `![alt](src){…}` line for an image (shared by the body-figure and the behind-layer paths). */
function imageLine(image: NonNullable<SlideIR["image"]>): string {
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

  // Choose the namespace with the SAME rule the parser uses (slide-roles): a Title/Closing layout OR
  // the presence of meta placeholders means the title/subtitle live at idx 0/1 (else 15/16). Deriving
  // this from isTitleNamespace (not the layout name alone) round-trips an auto-layout slide that carries
  // Category/Date/Footer — otherwise its title + meta would be read from the empty content idxs and lost.
  // A grouped slide (card/step/kpi) is NEVER a title slide — even if autoSelectLayout resolves it to a
  // Title layout — so it must not take the title branch (which would read the title from the empty
  // title-namespace idx and drop the columns + groupKind). Gate the title branch on !groupKind.
  const hasMeta = META_IDXS.some((idx) => getPlaceholderText(slide, idx));
  if (!slide.groupKind && isTitleNamespace(layout, hasMeta)) {
    // Title namespace: idx 0 = title, idx 1 = subtitle, idx 10/11/12 = meta fields.
    const title = getPlaceholderText(slide, TITLE_NS.title);
    const subtitle = getPlaceholderText(slide, TITLE_NS.subtitle);
    if (title) lines.push(`# ${title}`);
    if (subtitle) lines.push(`## ${subtitle}`);
    lines.push("");

    // Fields
    for (const { name, idx } of META_FIELDS) {
      const text = getPlaceholderText(slide, idx);
      if (text) lines.push(`${name}: ${text}`);
    }

    // A figure mis-pinned to a Title/Closing layout must still round-trip (not vanish).
    const fig = figureBlock(slide);
    if (fig) {
      lines.push("");
      lines.push(fig);
    }
  } else {
    // Content namespace: idx 15 = title, idx 16 = subtitle
    const title = getPlaceholderText(slide, CONTENT_NS.title);
    const subtitle = getPlaceholderText(slide, CONTENT_NS.subtitle);
    if (title) lines.push(`# ${title}`);
    if (subtitle) lines.push(`> ${subtitle}`);
    lines.push("");

    // Prefer the slide's own group kind (card/step/kpi) over inferring from the layout name, so a
    // `<!-- card -->` slide round-trips as a card even before it's pinned to a card layout. But a
    // single-body table/code is NEVER column-scoped: a figure slide that merely RESOLVED to a
    // Column/KPI/Process layout must serialize as single-body (else the parser re-absorbs the
    // trailing table/code into the last column). So the separator branch requires no single-body figure.
    const sepType = slide.groupKind ?? getSeparatorType(layout);
    const singleBodyFigure = !!(slide.table || slide.code || (slide.image && !slide.image.behind));

    if (sepType && !singleBodyFigure) {
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
      // Single body: idx 1 (table / code / diagram / mermaid all serialize here).
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

  // A BEHIND image is emitted last, on its own line — it's a backmost LAYER, not the body figure, so it
  // coexists with (never replaces) the title/body/figure above. The parser re-reads it into slide.image.
  if (slide.image?.behind) {
    lines.push("");
    lines.push(imageLine(slide.image));
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
