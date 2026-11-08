/**
 * apply-slide-edit.ts — the ONE inner "apply an AI edit to a SlideIR" logic that both deck-editing
 * doors share (#220, R8 option a). Pure logic (R2): no DOM / Tauri / MCP.
 *
 *   figure edit   — MCP setDiagram ⇄ GUI applyFigureYaml (ai-apply.ts)
 *   Markdown edit — MCP applySlideMarkdown ⇄ GUI reconcileSlideEdit (ai-apply.ts → reconcileEdit)
 *
 * Each door keeps its outer shell (MCP: placement guard / reject + mutation envelope; GUI: raw-AI-output
 * sanitizing, title restore + meltdown guard, adoption gate). The canonicalization (source → stored YAML),
 * the placement (replace / graduate / add-and-coexist), the block carry (an omitted figure/table/code is
 * kept) and the broken-figure check live here so the doors can't drift. Agreement is pinned by
 * tests/edit-path-agreement.test.ts.
 */
import type { SlideIR } from "./slide-schema";
import { mermaidToDiagramSpec, validateDiagramSource, type DiagramFormat } from "./mermaid-to-diagram";
import { diagramSpecToYaml } from "./diagram-serialize";
import { DiagramSpecSchema } from "./schema";
import { applyRegionSplit } from "./design-intent";
import { hasText } from "./slide-roles";
import { slideFigures } from "./slide-figures";
import { autoSelectLayout } from "./template-loader";
import type { LayoutCatalog } from "./template-catalog";

/** True when any body region (idx 1..9) carries text — the trigger for coexist placement. */
export function hasBodyText(slide: SlideIR): boolean {
  return slide.placeholders.some((p) => /^[1-9]$/.test(p.idx) && hasText(p));
}

/** Validate a figure source and canonicalize it to the YAML stored in `diagram.yaml`. YAML is stored
 *  verbatim; JSON / Mermaid are converted to a DiagramSpec and serialized. */
export function figureSourceToYaml(source: string, format: DiagramFormat): { yaml: string } | { error: string } {
  const verr = validateDiagramSource(source, format);
  if (verr) return { error: verr };
  if (format === "mermaid") {
    const spec = mermaidToDiagramSpec(source);
    if (!spec) return { error: "この Mermaid はネイティブ図に変換できません（gitGraph / sankey / C4 等）。" };
    return { yaml: diagramSpecToYaml(spec) };
  }
  if (format === "json") return { yaml: diagramSpecToYaml(DiagramSpecSchema.parse(JSON.parse(source))) };
  return { yaml: source };
}

/** The layout slide `i` resolves to (= export's choice, unknown pins included #435) and its body-region
 *  count — the ONE "can this slide host an added figure" judgment: MCP's set_diagram guard rejects on 0,
 *  the GUI shell re-autos a bodyless pin (#220 A2). */
export function resolvedBodyCount(slide: SlideIR, i: number, total: number, catalog: LayoutCatalog): { layoutName: string; bodyCount: number } {
  const layoutName = autoSelectLayout(slide, i, total, catalog);
  return { layoutName, bodyCount: catalog.find((e) => e.name === layoutName)?.bodyCount ?? 0 };
}

/** Carry the blocks an edit OMITTED (diagram / Mermaid / table / code) from the old slide — a text edit
 *  that leaves a block out keeps it (no silent drop); a block the edit carries is respected (#220 B3).
 *  #392 D1: the 2nd+ visuals (`figures`) ride along only when the edit carries NO body visual at all — a
 *  text-only edit of a multi-figure slide keeps every figure; an edit with its own visuals is taken as-is
 *  (per-figure carry is #392 段 3). */
export function carryOmittedBlocks(old: SlideIR, edited: SlideIR): SlideIR {
  const textOnly = slideFigures(edited).length === 0;
  return {
    ...edited,
    diagram: edited.diagram ?? old.diagram,
    mermaidBlock: edited.mermaidBlock ?? old.mermaidBlock,
    table: edited.table ?? old.table,
    code: edited.code ?? old.code,
    ...(textOnly && old.figures ? { figures: old.figures } : {}),
  };
}

/** The validation error of the ```diagram an edit carries, or null (none / valid). Neither door stores a
 *  broken figure: the GUI keeps the old one + an advisory, MCP rejects the edit (#220 B3). */
export function editedDiagramError(edited: SlideIR): string | null {
  return edited.diagram ? validateDiagramSource(edited.diagram.yaml, "yaml") : null;
}

export interface PlaceFigureOptions {
  /** Target region. Replace: retarget (default = the existing figure's). Add: body ordinal (default "1"). */
  placeholderIdx?: string;
}

/**
 * Place an already-canonical DiagramSpec YAML as the slide's figure:
 *   1. a native diagram exists → replace its YAML (a coexisting Mermaid block is KEPT — never a silent drop);
 *   2. only a Mermaid block → it GRADUATES to a native diagram in the same region;
 *   3. figureless → ADD it; existing body text moves to the other column (regionSplit text-left) so the
 *      bullets are never clobbered. With an empty body the layout pin is KEPT (#220 A2: a figure add never
 *      silently unpins the user's layout; with body text regionSplit re-autos as part of the split).
 */
export function placeFigureYaml(slide: SlideIR, yaml: string, opts: PlaceFigureOptions = {}): SlideIR {
  if (slide.diagram) return { ...slide, diagram: { yaml, placeholderIdx: opts.placeholderIdx ?? slide.diagram.placeholderIdx } };
  if (slide.mermaidBlock) {
    const { mermaidBlock, ...rest } = slide;
    return { ...rest, diagram: { yaml, placeholderIdx: opts.placeholderIdx ?? mermaidBlock.placeholderIdx } };
  }
  const withFigure: SlideIR = { ...slide, diagram: { yaml, placeholderIdx: opts.placeholderIdx ?? "1" } };
  return hasBodyText(slide) ? applyRegionSplit(withFigure, "text-left") : withFigure;
}
