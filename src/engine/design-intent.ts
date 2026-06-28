/**
 * design-intent.ts — Stage ② (design): the small, SEMANTIC spatial intent the AI
 * emits, plus the deterministic engine that turns it into concrete geometry.
 *
 * The harness pattern (same as DeckPlan, applied to SPACE): the model is good at
 * "emphasize the DB node" / "put the diagram on the right" but bad at pixels — so
 * it emits a tiny DesignIntent and the ENGINE computes + CLAMPS the actual layout
 * (which column, node overrides in inches), guaranteeing a valid result. The human
 * then fine-tunes with direct drag/resize on top.
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import { z } from "zod";
import * as yaml from "js-yaml";
import type { SlideIR, PlaceholderContent } from "./slide-schema";
import { DiagramSpecSchema, type DiagramSpec, type NodeOverride } from "./schema";
import { computeLayout, SLIDE_W, SLIDE_H, type NodePosition } from "./layout-engine";
import { diagramSpecToYaml, mermaidToDiagramSpec, dumpDiagramLikeSource } from "./mermaid-to-diagram";
import { parseJsonLoose } from "./json-salvage";

// ── DesignIntent: the small structure the model emits (a list of ops) ──

export const DesignIntentSchema = z.array(
  z.discriminatedUnion("op", [
    // Where the figure sits relative to the text (maps to layout/region).
    z.object({ op: z.literal("regionSplit"), arrangement: z.enum(["text-left", "text-right", "diagram-only"]) }),
    // Make a node focal (maps to a size/position override — engine computes geometry).
    z.object({ op: z.literal("emphasize"), nodeId: z.string(), level: z.enum(["high", "medium"]).default("high") }),
    // Re-flow the diagram in a direction (maps to DiagramSpec.direction → re-layout).
    z.object({ op: z.literal("relayout"), direction: z.enum(["TB", "LR", "RL", "BT"]) }),
  ]),
);
export type DesignIntent = z.infer<typeof DesignIntentSchema>;
export type DesignOp = DesignIntent[number];

/**
 * Detect a DesignIntent in raw model output. Per-slide AI replies with EITHER slide
 * Markdown (content edit) OR a DesignIntent JSON array (design edit); this returns
 * the intent when the output is the latter, else null (→ treat as Markdown).
 */
export function parseDesignIntent(raw: string): DesignIntent | null {
  const r = parseJsonLoose(raw);
  if (!r.ok || !Array.isArray(r.value) || r.value.length === 0) return null;
  const d = DesignIntentSchema.safeParse(r.value);
  return d.success ? d.data : null;
}

// ── Helpers ──

function specFromYaml(text: string): DiagramSpec | null {
  try {
    const r = DiagramSpecSchema.safeParse(yaml.load(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

type RawDiagram = { direction?: string; nodes?: Array<Record<string, unknown>>; [k: string]: unknown };

/**
 * Compute the emphasis override box for a node: enlarge it (keeping its centre) and
 * CLAMP within the slide bounds. The engine owns the geometry; the model only chose
 * which node + how strong.
 */
function emphasisOverride(pos: NodePosition, level: "high" | "medium"): NodeOverride {
  const scale = level === "high" ? 1.5 : 1.25;
  const cx = pos.x + pos.w / 2;
  const cy = pos.y + pos.h / 2;
  const w = Math.min(pos.w * scale, SLIDE_W);
  const h = Math.min(pos.h * scale, SLIDE_H);
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    x: round(Math.max(0, Math.min(cx - w / 2, SLIDE_W - w))),
    y: round(Math.max(0, Math.min(cy - h / 2, SLIDE_H - h))),
    w: round(w),
    h: round(h),
  };
}

/**
 * Run a figure transform on the slide. Geometry is computed from the parsed
 * DiagramSpec; the change is written into the RAW YAML object and re-dumped
 * losslessly (mirrors the drag path — keeps overrides/fields the hand-rolled
 * diagramSpecToYaml would drop). A Mermaid figure graduates to the canonical diagram.
 */
function applyToFigure(slide: SlideIR, mutate: (spec: DiagramSpec, raw: RawDiagram) => void): SlideIR {
  let baseYaml: string | null = null;
  if (slide.diagram) baseYaml = slide.diagram.yaml;
  else if (slide.mermaidBlock) {
    const s = mermaidToDiagramSpec(slide.mermaidBlock.mermaid);
    baseYaml = s ? diagramSpecToYaml(s) : null;
  }
  if (!baseYaml) return slide;

  const spec = specFromYaml(baseYaml);
  if (!spec) return slide;
  let raw: RawDiagram;
  try {
    raw = (yaml.load(baseYaml) ?? {}) as RawDiagram;
  } catch {
    return slide;
  }
  mutate(spec, raw);

  const placeholderIdx = slide.diagram?.placeholderIdx ?? slide.mermaidBlock?.placeholderIdx ?? "1";
  const { mermaidBlock: _drop, ...rest } = slide;
  void _drop;
  return { ...rest, diagram: { yaml: dumpDiagramLikeSource(raw, baseYaml), placeholderIdx } };
}

function emphasizeFigure(slide: SlideIR, nodeId: string, level: "high" | "medium"): SlideIR {
  return applyToFigure(slide, (spec, raw) => {
    const pos = computeLayout(spec).find((p) => p.nodeId === nodeId);
    if (!pos) return; // unknown node id → no-op
    const node = raw.nodes?.find((n) => n.id === nodeId);
    if (node) node.override = emphasisOverride(pos, level);
  });
}

/** regionSplit: put the figure in a column and the text in the other (template fills the geometry). */
function applyRegionSplit(slide: SlideIR, arrangement: "text-left" | "text-right" | "diagram-only"): SlideIR {
  const hasFigure = !!slide.diagram || !!slide.mermaidBlock;
  if (!hasFigure) return slide;

  if (arrangement === "diagram-only") {
    // figure fills the single body; drop the body bullets to title/figure only.
    const placeholders = slide.placeholders.filter((p) => !/^[1-9]$/.test(p.idx));
    const figIdx = "1";
    return withFigureIdx({ ...slide, layout: "auto", placeholders }, figIdx);
  }

  const figIdx = arrangement === "text-right" ? "1" : "2"; // text-left → figure on the right (col 2)
  const textIdx = arrangement === "text-right" ? "2" : "1";
  const placeholders: PlaceholderContent[] = slide.placeholders.map((p) =>
    /^[1-9]$/.test(p.idx) ? { ...p, idx: textIdx } : p,
  );
  return withFigureIdx({ ...slide, layout: "auto", placeholders }, figIdx);
}

function withFigureIdx(slide: SlideIR, idx: string): SlideIR {
  const next = { ...slide };
  if (next.diagram) next.diagram = { ...next.diagram, placeholderIdx: idx };
  if (next.mermaidBlock) next.mermaidBlock = { ...next.mermaidBlock, placeholderIdx: idx };
  return next;
}

/**
 * Apply a sequence of design intents to a slide. Each op is mapped to concrete,
 * clamped geometry by the engine; the slide stays valid (template-driven layout,
 * in-bounds node overrides). Unknown node ids / missing figures are no-ops.
 */
export function applyDesignIntent(slide: SlideIR, intents: DesignIntent): SlideIR {
  let next = slide;
  for (const intent of intents) {
    if (intent.op === "regionSplit") {
      next = applyRegionSplit(next, intent.arrangement);
    } else if (intent.op === "emphasize") {
      next = emphasizeFigure(next, intent.nodeId, intent.level);
    } else if (intent.op === "relayout") {
      next = applyToFigure(next, (_spec, raw) => {
        raw.direction = intent.direction;
      });
    }
  }
  return next;
}
