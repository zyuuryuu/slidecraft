/**
 * ai-apply.ts — apply an AI edit RESULT to a slide. Pure logic (R2): no DOM / Tauri.
 *
 * The AI "diagram-edit" mode returns a BARE DiagramSpec YAML (not Markdown). If the adopt path
 * parses it as Markdown it yields no diagram — so the figure edit is silently lost and the OLD
 * diagram is kept ("採用しても反映されない"). This detects that case and swaps the new YAML into
 * the slide's existing diagram.
 */
import type { SlideIR } from "./slide-schema";
import { validateDiagramSource } from "./mermaid-to-diagram";

/**
 * If `raw` is a valid BARE DiagramSpec YAML and the slide already carries a diagram, return the
 * slide with that diagram's YAML replaced; otherwise null (not a figure-YAML edit — the caller
 * should fall back to the Markdown path). Markdown (with a `#` heading etc.) is NOT valid DiagramSpec
 * YAML, so a normal slide edit falls through unchanged.
 */
export function applyFigureYaml(slide: SlideIR, raw: string): SlideIR | null {
  if (!slide.diagram) return null;
  if (validateDiagramSource(raw, "yaml")) return null; // truthy = invalid → not a figure-YAML edit
  return { ...slide, diagram: { ...slide.diagram, yaml: raw } };
}
