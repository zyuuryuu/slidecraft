/**
 * diagram-edit-ops.ts — Stage ② CONTENT edit: the small structured ops the AI emits to change a
 * diagram's DATA (labels / nodes / edges / direction), plus the deterministic engine that MERGES them
 * into the existing figure's raw YAML. Only the touched fields change; everything else re-dumps with
 * its values intact (zero data-drift, fastest). Mirrors design-intent's apply_design_intent (geometry
 * ops) — this is the content sibling. A full-figure DiagramSpec remains the fallback for models that
 * can't emit ops. ADR-0019.
 *
 * Pure logic (R2): no DOM / Tauri.
 */
import { z } from "zod";
import type { SlideIR } from "./slide-schema";
import { VALID_SHAPES, VALID_RELATIONS } from "./schema";
import { applyToFigure, type RawDiagram } from "./design-intent";
import { parseJsonLoose } from "./json-salvage";

// ── DiagramEditOp: the changed-fields-only ops the model emits (a bare JSON ops array) ──

export const DiagramEditOpsSchema = z.array(
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("nodeUpdate"), id: z.string(), label: z.string().optional(), sublabel: z.string().optional(), value: z.number().optional(), icon: z.string().optional(), shape: z.enum(VALID_SHAPES).optional() }),
    z.object({ op: z.literal("addNode"), id: z.string(), label: z.string(), shape: z.enum(VALID_SHAPES).optional(), group: z.string().optional() }),
    z.object({ op: z.literal("removeNode"), id: z.string() }),
    z.object({ op: z.literal("edgeUpdate"), from: z.string(), to: z.string(), label: z.string().optional(), relation: z.enum(VALID_RELATIONS).optional() }),
    z.object({ op: z.literal("addEdge"), from: z.string(), to: z.string(), label: z.string().optional() }),
    z.object({ op: z.literal("removeEdge"), from: z.string(), to: z.string() }),
    z.object({ op: z.literal("setDirection"), direction: z.enum(["TB", "LR", "RL", "BT"]) }),
  ]),
);
export type DiagramEditOps = z.infer<typeof DiagramEditOpsSchema>;
export type DiagramEditOp = DiagramEditOps[number];

/** One op that didn't take effect (unknown id / no figure) — surfaced never-silently (mirrors design SkippedOp). */
export interface SkippedDiagramOp {
  op: DiagramEditOp["op"];
  reason: "no-figure" | "unknown-node" | "unknown-edge" | "duplicate-id";
  message: string; // human, Japanese — ready to show as a notice
}

/**
 * Detect a DiagramEditOps array in raw model output (the WHOLE trimmed string is a bare `[ … ]` array,
 * optionally ```-fenced). Distinct from parseDesignIntent by its op literals (nodeUpdate/… vs
 * regionSplit/…), so a design-op array won't match here and vice-versa; prose that merely QUOTES an
 * example array isn't hijacked (whole-string requirement). Returns null → not an ops edit (fall back).
 */
export function parseDiagramEditOps(raw: string): DiagramEditOps | null {
  let t = raw.trim();
  const fence = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fence) t = fence[1].trim();
  if (!(t.startsWith("[") && t.endsWith("]"))) return null;
  const r = parseJsonLoose(t);
  if (!r.ok || !Array.isArray(r.value) || r.value.length === 0) return null;
  const d = DiagramEditOpsSchema.safeParse(r.value);
  return d.success ? d.data : null;
}

const idsOf = (raw: RawDiagram): string => (raw.nodes ?? []).map((n) => String(n.id)).join(", ") || "なし";

/**
 * Merge DiagramEditOps into the slide's figure DETERMINISTICALLY: only the named node/edge fields are
 * mutated on the parsed raw YAML; untouched fields keep their exact values and re-dump via
 * applyToFigure. Ops that can't apply (unknown id, no figure, duplicate add) are collected in `skipped`
 * — never silently dropped (mirrors applyDesignIntentReport). The batch never aborts. ADR-0019.
 */
export function applyDiagramEditOps(slide: SlideIR, ops: DiagramEditOps): { slide: SlideIR; skipped: SkippedDiagramOp[] } {
  const skipped: SkippedDiagramOp[] = [];
  if (!slide.diagram && !slide.mermaidBlock) {
    return { slide, skipped: ops.map((op) => ({ op: op.op, reason: "no-figure" as const, message: "図がないため編集をスキップしました。" })) };
  }
  const out = applyToFigure(slide, (_spec, raw) => {
    raw.nodes ??= [];
    raw.edges ??= [];
    for (const op of ops) {
      switch (op.op) {
        case "nodeUpdate": {
          const n = raw.nodes.find((x) => String(x.id) === op.id);
          if (!n) { skipped.push({ op: op.op, reason: "unknown-node", message: `ノード「${op.id}」が見つからず更新をスキップ（候補: ${idsOf(raw)}）。` }); break; }
          if (op.label !== undefined) n.label = op.label;
          if (op.sublabel !== undefined) n.sublabel = op.sublabel;
          if (op.value !== undefined) n.value = op.value;
          if (op.icon !== undefined) n.icon = op.icon;
          if (op.shape !== undefined) n.shape = op.shape;
          break;
        }
        case "addNode": {
          if (raw.nodes.some((x) => String(x.id) === op.id)) { skipped.push({ op: op.op, reason: "duplicate-id", message: `ノード id「${op.id}」は既に存在するため追加をスキップしました。` }); break; }
          raw.nodes.push({ id: op.id, label: op.label, ...(op.shape ? { shape: op.shape } : {}), ...(op.group ? { group: op.group } : {}) });
          break;
        }
        case "removeNode": {
          const before = raw.nodes.length;
          raw.nodes = raw.nodes.filter((x) => String(x.id) !== op.id);
          raw.edges = raw.edges.filter((e) => String(e.from) !== op.id && String(e.to) !== op.id); // drop now-dangling edges
          if (raw.nodes.length === before) skipped.push({ op: op.op, reason: "unknown-node", message: `ノード「${op.id}」が見つからず削除をスキップしました。` });
          break;
        }
        case "edgeUpdate": {
          const e = raw.edges.find((x) => String(x.from) === op.from && String(x.to) === op.to);
          if (!e) { skipped.push({ op: op.op, reason: "unknown-edge", message: `エッジ「${op.from}→${op.to}」が見つからず更新をスキップしました。` }); break; }
          if (op.label !== undefined) e.label = op.label;
          if (op.relation !== undefined) e.relation = op.relation;
          break;
        }
        case "addEdge": {
          raw.edges.push({ from: op.from, to: op.to, ...(op.label ? { label: op.label } : {}) });
          break;
        }
        case "removeEdge": {
          const before = raw.edges.length;
          raw.edges = raw.edges.filter((e) => !(String(e.from) === op.from && String(e.to) === op.to));
          if (raw.edges.length === before) skipped.push({ op: op.op, reason: "unknown-edge", message: `エッジ「${op.from}→${op.to}」が見つからず削除をスキップしました。` });
          break;
        }
        case "setDirection": {
          raw.direction = op.direction;
          break;
        }
      }
    }
  });
  return { slide: out, skipped };
}
