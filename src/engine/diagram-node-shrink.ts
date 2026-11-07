/**
 * diagram-node-shrink.ts — #473: how far the layout engine shrank a node-edge figure, read off the
 * SAME geometry export paints: computeLayout's NodePosition (w/h/scale), the region fit a beside-text
 * figure gets (fitTransform) and the label font the painter emits (scaledFontSize on the node's
 * resolved style). No second shrink computation (R8) — this module only OBSERVES the export path and
 * says whether the result dropped below the legible floor. Diagnostics only: nothing here changes
 * placement or output.
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import { loadYaml } from "./yaml-io";
import { DiagramSpecSchema, type DiagramSpec } from "./schema";
import type { SlideIR } from "./slide-schema";
import { computeLayout } from "./layout-engine";
import { fitTransform, scaledFontSize, type Box } from "./draw-target";
import { resolveNodeStyle } from "./diagram-painter";

/**
 * Smallest label font (pt) the painter sets ON PURPOSE: sublabels and class-member rows floor at
 * `Math.max(font_size - 3, 7)` / `Math.max(font_size - 2, 7)` (diagram-draw.ts), so 7pt is the renderer's
 * own notion of "smallest intentional text". Auto-shrink driving the MAIN label under it means the
 * figure is below what the renderer itself considers minimal — scaledFontSize's 5pt floor is a
 * draw guard, not a legibility target. Calibration (default 11pt label, Midnight layout 2.0×0.7in,
 * solo figure): 9–10 nodes → 8.9–7.6pt (silent), 13 nodes → 5.9pt, 20 nodes → 5pt (warn).
 */
export const LEGIBLE_LABEL_PT = 7;

/** Figure types the node-edge engine lays out (everything else is a "second engine" with its own
 *  layout — sequence / timeline / … — and is out of scope here). */
const NODE_EDGE_TYPES: ReadonlySet<DiagramSpec["type"]> = new Set(["flowchart", "network", "orgchart"]);

export interface DiagramNodeShrink {
  type: DiagramSpec["type"];
  direction: DiagramSpec["direction"];
  nodeCount: number;
  /** Smallest exported node box (inches), after layout scale AND region fit. */
  minNodeW: number;
  minNodeH: number;
  /** Smallest label font (pt) the painter will emit for a labeled node. */
  minLabelPt: number;
}

export type DiagramParseResult = { ok: true; spec: DiagramSpec } | { ok: false; error: string };

/** #587: parse a slide's ```diagram YAML the way export does (loadYaml + DiagramSpecSchema), KEEPING the
 *  failure reason (zod `path: message` per issue, or the YAML load error) so a figure that would not
 *  render is reported, never silently skipped. The ONE parse path — parseDiagramYaml wraps it (R8). */
export function parseDiagramYamlResult(yaml: string): DiagramParseResult {
  let raw: unknown;
  try {
    raw = loadYaml(yaml);
  } catch (e) {
    return { ok: false, error: `YAML: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` };
  }
  const r = DiagramSpecSchema.safeParse(raw);
  if (r.success) return { ok: true, spec: r.data };
  return { ok: false, error: r.error.issues.map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join(" / ") };
}

/** Parse a slide's ```diagram YAML; undefined when it would not render (reason: parseDiagramYamlResult). */
export function parseDiagramYaml(yaml: string): DiagramSpec | undefined {
  const r = parseDiagramYamlResult(yaml);
  return r.ok ? r.spec : undefined;
}

/** #587: the never-silent message for a figure DiagramSpecSchema rejects, or undefined when it parses.
 *  Shared by get_deck_issues and validate_deck so the judgment and wording are defined once (R8). */
export function diagramInvalidReason(yaml: string): string | undefined {
  const r = parseDiagramYamlResult(yaml);
  return r.ok ? undefined : `図（\`\`\`diagram）が不正なため描画されません: ${r.error}（構文は get_diagram_guide）`;
}

/** #587: every slide whose ```diagram would not render, with the same message (validate_deck's gate;
 *  get_deck_issues reports the same per slide as diagram-invalid). slideIndex is 0-based like theirs. */
export function invalidDiagrams(slides: readonly SlideIR[]): { slideIndex: number; message: string }[] {
  return slides.flatMap((sl, i) => {
    const message = sl.diagram && diagramInvalidReason(sl.diagram.yaml);
    return message ? [{ slideIndex: i, message }] : [];
  });
}

/**
 * The shrink export applies to `spec`'s labeled nodes, or undefined when the smallest painted label
 * stays at/above LEGIBLE_LABEL_PT (or the figure is not node-edge / has no labeled nodes).
 * `region` = the placeholder box a beside-text figure is confined to (placeholder-filler passes the
 * resolved body placeholder's style); omit for a solo figure, which fills the slide as laid out.
 */
export function diagramNodeShrink(spec: DiagramSpec, region?: Box): DiagramNodeShrink | undefined {
  if (!NODE_EDGE_TYPES.has(spec.type)) return undefined;
  // Export paints an embedded figure with omitTitle → the painter's default contentTop, which is
  // computeLayout's own default — so the bare call IS the export geometry.
  const positions = computeLayout(spec);
  if (positions.length === 0) return undefined;
  const layoutScale = positions[0].scale; // what paintDiagram hands paintShape as layoutScale
  let regionScale = 1;
  if (region) {
    const bbox = {
      minX: Math.min(...positions.map((p) => p.x)),
      minY: Math.min(...positions.map((p) => p.y)),
      maxX: Math.max(...positions.map((p) => p.x + p.w)),
      maxY: Math.max(...positions.map((p) => p.y + p.h)),
    };
    regionScale = fitTransform(bbox, region).scale; // TransformedTarget multiplies boxes AND font sizes by this
  }

  const posById = new Map(positions.map((p) => [p.nodeId, p]));
  let minLabelPt = Infinity;
  let minNodeW = Infinity;
  let minNodeH = Infinity;
  for (const node of spec.nodes) {
    // start/end pseudo-states paint as a dot without a label (paintStateMarker) — nothing to read.
    if (node.shape === "start" || node.shape === "end" || !node.label.trim()) continue;
    const pos = posById.get(node.id);
    if (!pos) continue;
    const pt = scaledFontSize(resolveNodeStyle(spec, node).font_size, layoutScale) * regionScale;
    minLabelPt = Math.min(minLabelPt, pt);
    minNodeW = Math.min(minNodeW, pos.w * regionScale);
    minNodeH = Math.min(minNodeH, pos.h * regionScale);
  }
  if (!Number.isFinite(minLabelPt) || minLabelPt >= LEGIBLE_LABEL_PT) return undefined;
  return { type: spec.type, direction: spec.direction, nodeCount: spec.nodes.length, minNodeW, minNodeH, minLabelPt };
}

/** The warn text deck-diagnostics attaches to `diagram-node-shrink`. `where` names the fit target. */
export function diagramNodeShrinkMessage(s: DiagramNodeShrink, where: "スライド" | "枠"): string {
  const flip = s.direction === "LR" || s.direction === "RL" ? "TB" : "LR";
  return (
    `図（${s.type}・${s.nodeCount} ノード・${s.direction}）は${where}に収めるため自動縮小され、` +
    `ノードが約 ${s.minNodeW.toFixed(2)}×${s.minNodeH.toFixed(2)}in（ラベル約 ${s.minLabelPt.toFixed(1)}pt、可読の目安 ${LEGIBLE_LABEL_PT}pt）まで縮みます。` +
    `階層ごとにスライドを分割する、direction を ${flip} に変える、\`\`\`mermaid mindmap にする、または表にすることを検討してください`
  );
}
