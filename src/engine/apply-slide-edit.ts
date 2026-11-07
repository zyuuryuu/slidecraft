/**
 * apply-slide-edit.ts — the ONE inner "apply a figure edit to a SlideIR" logic that both deck-editing
 * doors share (#220, R8 option a). Pure logic (R2): no DOM / Tauri / MCP.
 *
 *   MCP door : src/mcp/session.ts setDiagram     (shell: placement guard + mutation envelope)
 *   GUI door : src/engine/ai-apply.ts applyFigureYaml (shell: raw-AI-output sanitizing + adoption gate)
 *
 * Each door keeps its outer shell; the canonicalization (source → stored YAML) and the placement
 * (replace / graduate / add-and-coexist) live here so the two can't drift. Agreement is pinned by
 * tests/edit-path-agreement.test.ts.
 */
import type { SlideIR } from "./slide-schema";
import { mermaidToDiagramSpec, validateDiagramSource, type DiagramFormat } from "./mermaid-to-diagram";
import { diagramSpecToYaml } from "./diagram-serialize";
import { DiagramSpecSchema } from "./schema";
import { applyRegionSplit } from "./design-intent";
import { hasText } from "./ai-reconcile";

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

export interface PlaceFigureOptions {
  /** Target region. Replace: retarget (default = the existing figure's). Add: body ordinal (default "1"). */
  placeholderIdx?: string;
  /** Layout when ADDING to a figureless slide whose body has no text (with body text, regionSplit always
   *  re-autos). MCP "keep" (its guard validated the ordinal against the pinned layout) vs GUI "auto" (let
   *  the engine pick a fitting layout). A known divergence, pinned in edit-path-agreement — #220. */
  addLayout: "keep" | "auto";
}

/**
 * Place an already-canonical DiagramSpec YAML as the slide's figure:
 *   1. a native diagram exists → replace its YAML (a coexisting Mermaid block is KEPT — never a silent drop);
 *   2. only a Mermaid block → it GRADUATES to a native diagram in the same region;
 *   3. figureless → ADD it; existing body text moves to the other column (regionSplit text-left) so the
 *      bullets are never clobbered.
 */
export function placeFigureYaml(slide: SlideIR, yaml: string, opts: PlaceFigureOptions): SlideIR {
  if (slide.diagram) return { ...slide, diagram: { yaml, placeholderIdx: opts.placeholderIdx ?? slide.diagram.placeholderIdx } };
  if (slide.mermaidBlock) {
    const { mermaidBlock, ...rest } = slide;
    return { ...rest, diagram: { yaml, placeholderIdx: opts.placeholderIdx ?? mermaidBlock.placeholderIdx } };
  }
  const withFigure: SlideIR = {
    ...slide,
    layout: opts.addLayout === "auto" ? "auto" : slide.layout,
    diagram: { yaml, placeholderIdx: opts.placeholderIdx ?? "1" },
  };
  return hasBodyText(slide) ? applyRegionSplit(withFigure, "text-left") : withFigure;
}
