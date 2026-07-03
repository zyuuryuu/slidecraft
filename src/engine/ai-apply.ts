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
import { applyRegionSplit } from "./design-intent";

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
 * If `raw` is (or wraps) a valid DiagramSpec YAML, apply it as the slide's figure; otherwise null (not
 * a figure-YAML edit — the caller falls back to the Markdown path). The raw is first sanitized (fence
 * unwrap + prose-preamble strip) so a ```yaml-fenced or "はい、図です:"-prefixed edit still applies
 * instead of leaking to the code path. Three cases:
 *   1. the slide already carries a figure → replace its YAML (the diagram-edit adopt path);
 *   2. a body-less slide → the figure fills the body;
 *   3. a slide WITH body text → ADD the figure and move the text to the other column (coexist, #3B) so
 *      "add a diagram" never destroys the existing bullets (preservation, same spirit as #12).
 */
export function applyFigureYaml(slide: SlideIR, raw: string): SlideIR | null {
  const yaml = sanitizeFigureSource(raw);
  if (validateDiagramSource(yaml, "yaml")) return null; // truthy = invalid → not a figure-YAML edit

  // 1. Replace an existing figure (diagram or mermaid).
  if (slide.diagram) return { ...slide, diagram: { ...slide.diagram, yaml } };
  if (slide.mermaidBlock) {
    const { mermaidBlock: _drop, ...rest } = slide;
    void _drop;
    return { ...rest, diagram: { yaml, placeholderIdx: slide.mermaidBlock.placeholderIdx } };
  }

  // 2/3. Add a figure to a figureless slide. Coexist with any body text (move it to the other column);
  // a body-less slide simply gets the figure in its body. layout → auto so the engine picks a fitting
  // (single-body or 2-column) layout.
  const hasBodyText = slide.placeholders.some(
    (p) => /^[1-9]$/.test(p.idx) && p.paragraphs.some((par) => par.segments.some((s) => s.text.trim())),
  );
  const withFigure: SlideIR = { ...slide, layout: "auto", diagram: { yaml, placeholderIdx: "1" } };
  return hasBodyText ? applyRegionSplit(withFigure, "text-left") : withFigure;
}
