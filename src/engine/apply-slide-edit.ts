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
import { carryFigures, diagramFigureNumbers, updateFigure } from "./slide-figure-edit";
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
 *  #392 段 3: on a slide with ≥2 visuals the carry is per visual (slide-figure-edit.carryFigures — the
 *  edit's i-th of a kind replaces the old i-th, the omitted ones stay in place). With ≤1 old visual it is
 *  the per-kind carry below, unchanged (single-visual decks byte-identical). */
export function carryOmittedBlocks(old: SlideIR, edited: SlideIR): SlideIR {
  if (slideFigures(old).length >= 2) return carryFigures(old, edited);
  return {
    ...edited,
    diagram: edited.diagram ?? old.diagram,
    mermaidBlock: edited.mermaidBlock ?? old.mermaidBlock,
    table: edited.table ?? old.table,
    code: edited.code ?? old.code,
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
  /** #392 段 3: replace the n-th figure (diagram / Mermaid in source order, 1-based) instead of the first.
   *  Must be in range (figureTargetError) — a figure is never added through it. */
  figure?: number;
}

/** Why `figure` cannot be targeted on this slide, or null (omitted / in range). Shared by MCP's reject and
 *  the GUI's null (R8). */
export function figureTargetError(slide: SlideIR, figure: number | undefined): string | null {
  if (figure === undefined) return null;
  const n = diagramFigureNumbers(slide).length;
  if (Number.isInteger(figure) && figure >= 1 && figure <= n) return null;
  return n === 0
    ? "このスライドには図がありません（figure は既存の図を指定します。図の追加は figure を省略）。"
    : `figure が範囲外です（このスライドの図は 1..${n}）。図の追加は set_slide_markdown で。`;
}

/**
 * Place an already-canonical DiagramSpec YAML as the slide's figure:
 *   1. a native diagram exists → replace its YAML (a coexisting Mermaid block is KEPT — never a silent drop);
 *   2. only a Mermaid block → it GRADUATES to a native diagram in the same region;
 *   3. figureless → ADD it; existing body text moves to the other column (regionSplit text-left) so the
 *      bullets are never clobbered. With an empty body the layout pin is KEPT (#220 A2: a figure add never
 *      silently unpins the user's layout; with body text regionSplit re-autos as part of the split).
 * The replaced figure is the n-th one with `figure` (#392 段 3; the caller has checked figureTargetError),
 * else the first diagram, else the first Mermaid — written through the one writer (slide-figure-edit), so
 * the singular field and its `figures` copy change together.
 */
export function placeFigureYaml(slide: SlideIR, yaml: string, opts: PlaceFigureOptions = {}): SlideIR {
  const list = slideFigures(slide);
  const firstOf = (kind: string) => list.findIndex((f) => f.kind === kind);
  const pos = opts.figure !== undefined ? diagramFigureNumbers(slide)[opts.figure - 1] - 1 : firstOf("diagram") >= 0 ? firstOf("diagram") : firstOf("mermaid");
  if (pos >= 0) return updateFigure(slide, pos, { kind: "diagram", yaml, placeholderIdx: opts.placeholderIdx ?? list[pos].placeholderIdx });
  const withFigure: SlideIR = { ...slide, diagram: { yaml, placeholderIdx: opts.placeholderIdx ?? "1" } };
  return hasBodyText(slide) ? applyRegionSplit(withFigure, "text-left") : withFigure;
}
