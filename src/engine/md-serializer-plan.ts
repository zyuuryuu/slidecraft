/**
 * md-serializer-plan.ts — ADR-0030 stage B: the plan-driven serializer readout.
 *
 * Serializes one NON-group slide by consuming the BindingPlan of its RESOLVED layout: each content's
 * markdown meaning (# title / ##|> subtitle / body) is the ROLE the binder read it under (ADR-0011
 * bijection — the readout mapping IS the binding mapping). This replaces md-serializer's layout-NAME
 * namespace fork, which mislabeled content whenever the name and the actual binding disagreed (#144:
 * a closing-vocabulary title resolved — without a catalog — to a Closing.* fallback name → the title
 * was read from the EMPTY title namespace and dropped, and the body serialized as "## …").
 *
 * Split from md-serializer.ts for R1. Pure logic (R2).
 */

import type { SlideIR, PlaceholderContent } from "./slide-schema";
import type { LayoutInfo } from "./template-loader";
import type { LayoutCatalog, PlaceholderRole } from "./template-catalog";
import { slideBindingPlan } from "./group-binding";
import { sortByIdx } from "./placeholder-binding";
import { TITLE_NS, META_FIELDS } from "./slide-roles";
import { serializeParagraphs, getPlaceholderText, figureBlock, getSeparatorType } from "./md-serializer-shared";

/**
 * The template context that lets the serializer read a slide back out through the SAME binding
 * authority the export/preview use (slideBindingPlan) instead of re-deriving a namespace from the
 * layout NAME. Optional on serializeMd — without it the historical catalog-free readout runs, so
 * template-less callers stay byte-identical.
 */
export interface SerializeTemplate {
  catalog: LayoutCatalog; // resolves "auto" to the layout the export actually uses
  layouts: readonly LayoutInfo[]; // the real placeholders behind each layout name (feeds slideBindingPlan)
}

/** Emit one non-group slide's content lines through its BindingPlan (see module header). */
export function serializeByPlan(slide: SlideIR, layout: string, layoutInfo: LayoutInfo, lines: string[]): void {
  const plan = slideBindingPlan(slide, layoutInfo);
  // Content idx → the binder's role for it. assignments ∪ unbound cover every non-blank content; a
  // blank-and-unbound content has no ref and is skipped — same as the legacy empty-text skip.
  const roleOf = new Map<string, PlaceholderRole>();
  for (const ref of plan.assignments.map((a) => a.content).concat(plan.unbound)) {
    if (!roleOf.has(ref.idx)) roleOf.set(ref.idx, ref.role);
  }
  const first = (role: PlaceholderRole): PlaceholderContent | undefined =>
    [...slide.placeholders].sort(sortByIdx).find((p) => roleOf.get(p.idx) === role);

  const title = first("title");
  const subtitle = first("subtitle");
  const titleText = title && serializeParagraphs(title.paragraphs);
  const subtitleText = subtitle && serializeParagraphs(subtitle.paragraphs);
  if (titleText) lines.push(`# ${titleText}`);
  // A ctrTitle cover's subtitle lives at idx 1 (TITLE_NS) → "## " (the form the parser reads back into
  // the title namespace); every other subtitle is the content-namespace "> " form.
  if (subtitleText) lines.push((subtitle!.idx === TITLE_NS.subtitle ? "## " : "> ") + subtitleText);
  lines.push("");

  // Meta (Category/Date/Footer) — canonical idxs as before, but no longer gated on the namespace fork.
  let metaCount = 0;
  for (const { name, idx } of META_FIELDS) {
    const text = getPlaceholderText(slide, idx);
    if (text) {
      lines.push(`${name}: ${text}`);
      metaCount++;
    }
  }

  const diagIdx = slide.diagram ? parseInt(slide.diagram.placeholderIdx) : NaN;
  const mermIdx = slide.mermaidBlock ? parseInt(slide.mermaidBlock.placeholderIdx) : NaN;
  const bodyIsh = (col: number) => roleOf.get(String(col)) === "body" || diagIdx === col || mermIdx === col;
  const singleBodyFigure = !!(slide.table || slide.code || (slide.image && !slide.image.behind));
  // Separator form when the layout name says so (canonical Column./KPI./Process.), or the slide holds a
  // title + ≥2 positional body regions — the legacy Columns fallback classification, so a third-party
  // template's multi-region slide keeps its <!-- col --> markers instead of collapsing into one body.
  const sepType = getSeparatorType(layout) ?? (title && bodyIsh(1) && bodyIsh(2) ? "col" : null);

  if (sepType && !singleBodyFigure) {
    let maxCol = 0;
    for (const p of slide.placeholders) {
      const n = parseInt(p.idx);
      if (/^\d+$/.test(p.idx) && n >= 1 && n <= 10 && roleOf.get(p.idx) === "body") maxCol = Math.max(maxCol, n);
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
        if (ph && roleOf.get(ph.idx) === "body") lines.push(serializeParagraphs(ph.paragraphs));
      }
      lines.push("");
    }
    return;
  }

  // Single body: idx 1 (only when the binder reads it as BODY — on a ctrTitle layout idx 1 is the
  // subtitle, already emitted above). A lead paragraph can coexist BESIDE a single-body
  // table/figure (#101) — both emit, body text first, then the figure block.
  const body = roleOf.get("1") === "body" ? getPlaceholderText(slide, "1") : undefined;
  if (body) lines.push(body);
  const fig = figureBlock(slide);
  if (fig) {
    if (body || metaCount > 0) lines.push(""); // keep the body/meta block visually separate from the figure
    lines.push(fig);
    return;
  }

  for (let idx = 2; idx <= 6; idx++) {
    const text = getPlaceholderText(slide, String(idx));
    if (text) {
      lines.push("");
      lines.push(text);
    }
  }
}
