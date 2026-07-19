/**
 * md-serializer.ts — Serialize DeckIR back to Markdown.
 *
 * Inverse of md-parser.ts. Used for:
 * - Exporting edited slides back to Markdown for LLM re-modification
 * - Round-trip preservation
 *
 * Two readouts (dispatched per slide in serializeSlide):
 * - PLAN-DRIVEN (md-serializer-plan.ts, ADR-0030 stage B): with a SerializeTemplate, content meaning
 *   comes from the BindingPlan of the RESOLVED layout — the readout can never diverge from what the
 *   export/preview actually bind (#144).
 * - LEGACY (serializeLegacy below): template-less callers keep the historical layout-NAME namespace
 *   fork, byte-for-byte. Grouped slides also stay here until ADR-0030 stage E unifies expandGroups.
 *
 * Emission primitives shared by both live in md-serializer-shared.ts (R1 split).
 */

import type { DeckIR, SlideIR } from "./slide-schema";
import { autoSelectLayout } from "./template-loader";
import { isTitleNamespace, META_FIELDS, META_IDXS, TITLE_NS, CONTENT_NS } from "./slide-roles";
import { serializeParagraphs, getPlaceholderText, figureBlock, imageLine, notesLines, getSeparatorType, isColumnScopedTable } from "./md-serializer-shared";
import { tableToMarkdown } from "./md-table";
import { serializeByPlan, type SerializeTemplate } from "./md-serializer-plan";
import { SECTION_NAV_LIST_LAYOUT, scanSections, sectionNavParagraphs, type SectionEntry } from "./deck-sections";

export type { SerializeTemplate } from "./md-serializer-plan";

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

// ── Serialize a single slide ──

function serializeSlide(
  slide: SlideIR,
  slideIndex: number,
  totalSlides: number,
  sections: SectionEntry[],
  tpl?: SerializeTemplate,
): string {
  const lines: string[] = [];

  // A derived TOC slide folds to its declaration ONLY — the content is re-derived at every
  // consumption point (deck-sections), so even a materialized deck writes no toc body back
  // (#151 / ADR-0032 D2: the deck never persists duplicated chapter state).
  if (slide.derived === "toc") {
    return "<!-- toc -->";
  }

  // A section-break slide materialized with the recap-list layout (#167) folds back to "auto" +
  // drops the injected idx-1 chapter list — that content is re-derived at every consumption point
  // (deck-sections.materializeDerivedSlides), so even a materialized deck writes nothing back
  // (mirrors the derived-toc fold above). The layout NAME alone is NOT proof of injection — since
  // it's a real entry in LAYOUT_NAMES, an author can explicitly pin it too and write their own idx-1
  // body (a real round-trip loss if we stripped unconditionally, caught in review). So the fold only
  // fires when idx-1's content DEEP-EQUALS what materialize would have derived for this exact slide —
  // an authored pin+body can never coincidentally match the numbered/bold recap text.
  if (slide.sectionBreak && slide.layout === SECTION_NAV_LIST_LAYOUT) {
    const current = sections.find((s) => s.slideIndex === slideIndex);
    const list = slide.placeholders.find((p) => p.idx === "1");
    const derived = current ? sectionNavParagraphs(sections, current.number) : undefined;
    if (current && list && JSON.stringify(list.paragraphs) === JSON.stringify(derived)) {
      slide = { ...slide, layout: "auto", placeholders: slide.placeholders.filter((p) => p.idx !== "1") };
    }
  }

  const layout =
    slide.layout === "auto"
      ? autoSelectLayout(slide, slideIndex, totalSlides, tpl?.catalog)
      : slide.layout;

  // `<!-- section -->` chapter declaration rides FIRST (the ADR-0032 D2 taught form); the
  // parser strips it before the layout-pin check, so ordering stays round-trip-safe.
  if (slide.sectionBreak) {
    lines.push("<!-- section -->");
  }

  // Emit the layout directive only when it was explicitly set. "auto" slides stay
  // directive-free so they round-trip as "auto" (re-resolved deterministically on
  // import) instead of being pinned to a concrete layout. `layout` (resolved) is
  // still used below to choose the serialization format.
  if (slide.layout !== "auto") {
    lines.push(`<!-- slide: ${layout} -->`);
  }

  // ADR-0030 stage B: with the template at hand, read a NON-group slide back out through the binding
  // authority (slideBindingPlan on the RESOLVED layout) instead of the name-based namespace fork below.
  // Grouped slides keep the legacy branch until stage E unifies expandGroups — their column readout is
  // positional (content idx 1..N), which the plan's transformed cell copies cannot key.
  const layoutInfo = slide.groupKind ? undefined : tpl?.layouts.find((l) => l.name === layout);
  if (layoutInfo) {
    serializeByPlan(slide, layout, layoutInfo, lines);
  } else {
    serializeLegacy(slide, layout, lines);
  }

  // A BEHIND image is emitted last, on its own line — it's a backmost LAYER, not the body figure, so it
  // coexists with (never replaces) the title/body/figure above. The parser re-reads it into slide.image.
  if (slide.image?.behind) {
    lines.push("");
    lines.push(imageLine(slide.image));
  }

  // Speaker notes are ALWAYS the slide's last emission (the parser reads marker→slide-end as notes).
  lines.push(...notesLines(slide));

  return lines.join("\n");
}

/** The historical (template-less) readout: namespace from the layout NAME + meta presence. Kept
 *  byte-for-byte for callers without a SerializeTemplate, and for grouped slides (stage E). */
function serializeLegacy(slide: SlideIR, layout: string, lines: string[]): void {
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
    // single-body code/image is NEVER column-scoped: a figure slide that merely RESOLVED to a
    // Column/KPI/Process layout must serialize as single-body (else the parser re-absorbs the
    // trailing figure into the last column). A table is the SAME — UNLESS it's genuinely
    // column-scoped (#100: bound to its own region beside other real column content), which
    // isColumnScopedTable (shared with md-serializer-plan, R8) distinguishes from that mis-pin.
    const sepType = slide.groupKind ?? getSeparatorType(layout);
    const tableColumnScoped = isColumnScopedTable(slide);
    const singleBodyFigure = !!(slide.code || (slide.image && !slide.image.behind) || (slide.table && !tableColumnScoped));

    if (sepType && !singleBodyFigure) {
      // Multi-section: each numbered region (column) becomes a section. A region may
      // hold TEXT or a FIGURE (diagram/mermaid/table) — emit the figure's fenced block in
      // its own column so text+figure COEXISTENCE round-trips (the figure sits beside
      // the bullets instead of replacing them). Iterate 1..max so column positions
      // (hence the figure's placeholderIdx) survive even with gaps/empties.
      const diagIdx = slide.diagram ? parseInt(slide.diagram.placeholderIdx) : NaN;
      const mermIdx = slide.mermaidBlock ? parseInt(slide.mermaidBlock.placeholderIdx) : NaN;
      const tableIdx = tableColumnScoped ? parseInt(slide.table!.placeholderIdx) : NaN;
      let maxCol = 0;
      for (const p of slide.placeholders) {
        const n = parseInt(p.idx);
        if (/^\d+$/.test(p.idx) && n >= 1 && n <= 10) maxCol = Math.max(maxCol, n);
      }
      if (!Number.isNaN(diagIdx)) maxCol = Math.max(maxCol, diagIdx);
      if (!Number.isNaN(mermIdx)) maxCol = Math.max(maxCol, mermIdx);
      if (!Number.isNaN(tableIdx)) maxCol = Math.max(maxCol, tableIdx);

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
        } else if (col === tableIdx) {
          lines.push(tableToMarkdown(slide.table!.rows));
        } else {
          const ph = slide.placeholders.find((p) => p.idx === String(col));
          if (ph) lines.push(serializeParagraphs(ph.paragraphs));
        }
        lines.push("");
      }
    } else {
      // Single body: idx 1 (table / code / diagram / mermaid all serialize here). A lead
      // paragraph (idx 1 TEXT) can coexist BESIDE a single-body table/figure (#101) — both
      // emit, body text first, then the figure block.
      const body = getPlaceholderText(slide, "1");
      if (body) lines.push(body);
      const fig = figureBlock(slide);
      if (fig) {
        if (body) lines.push("");
        lines.push(fig);
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
}

// ── Main serializer ──

export function serializeMd(deck: DeckIR, tpl?: SerializeTemplate): string {
  const parts: string[] = [];

  // Front matter
  if (deck.template) {
    parts.push("---");
    parts.push(`template: ${deck.template}`);
    parts.push("---");
    parts.push("");
  }

  // Computed once (not per-slide) — feeds the recap-list fold guard above (#167).
  const sections = deck.slides.some((s) => s.sectionBreak) ? scanSections(deck) : [];

  // Slides
  for (let i = 0; i < deck.slides.length; i++) {
    if (i > 0) {
      parts.push("");
      parts.push("---");
      parts.push("");
    }
    parts.push(serializeSlide(deck.slides[i], i, deck.slides.length, sections, tpl));
  }

  return parts.join("\n").trimEnd() + "\n";
}
