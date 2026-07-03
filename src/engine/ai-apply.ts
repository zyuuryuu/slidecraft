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

/** DiagramSpec YAML anchors — the first meaningful line of a spec is one of these top-level keys. */
const SPEC_KEY = /^\s*(type|nodes|edges|direction|title|classDefs|groups|lanes|fragments|activations|quadrant|gantt|xychart|radar|kpi|layout)\s*:/;

/**
 * Clean a figure-YAML candidate as a ~3B model tends to return it: unwrap a ```lang … ``` fence, and
 * drop a natural-language preamble ("はい、こちらが図です:") before the first DiagramSpec key. A normal
 * Markdown edit (no spec key) is returned unchanged and then fails validation downstream.
 */
function sanitizeFigureSource(raw: string): string {
  let t = raw.trim();
  const fence = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fence) t = fence[1].trim();
  const lines = t.split("\n");
  const start = lines.findIndex((l) => SPEC_KEY.test(l));
  if (start > 0) t = lines.slice(start).join("\n");
  return t;
}

/**
 * If `raw` is (or wraps) a valid DiagramSpec YAML and the slide already carries a diagram, return the
 * slide with that diagram's YAML replaced; otherwise null (not a figure-YAML edit — the caller falls
 * back to the Markdown path). The raw is first sanitized (fence unwrap + prose-preamble strip) so a
 * ```yaml-fenced or "はい、図です:"-prefixed edit still applies instead of leaking to the code path.
 * (ADDING a figure to a text slide — bare YAML on a diagram-less slide — is intentionally NOT handled
 * here; that would change this function's contract and is tracked separately.)
 */
export function applyFigureYaml(slide: SlideIR, raw: string): SlideIR | null {
  if (!slide.diagram) return null;
  const yaml = sanitizeFigureSource(raw);
  if (validateDiagramSource(yaml, "yaml")) return null; // truthy = invalid → not a figure-YAML edit
  return { ...slide, diagram: { ...slide.diagram, yaml } };
}
