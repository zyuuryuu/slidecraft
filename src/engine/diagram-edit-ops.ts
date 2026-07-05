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
import { applyToFigure, readFigureRaw, type RawDiagram } from "./design-intent";
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
const edgesOf = (raw: RawDiagram): string => (raw.edges ?? []).map((e) => `${String(e.from)}→${String(e.to)}`).join(", ") || "なし";

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
          if (raw.nodes.length === before) skipped.push({ op: op.op, reason: "unknown-node", message: `ノード「${op.id}」が見つからず削除をスキップ（候補: ${idsOf(raw)}）。` });
          break;
        }
        case "edgeUpdate": {
          const e = raw.edges.find((x) => String(x.from) === op.from && String(x.to) === op.to);
          if (!e) { skipped.push({ op: op.op, reason: "unknown-edge", message: `エッジ「${op.from}→${op.to}」が見つからず更新をスキップ（候補: ${edgesOf(raw)}）。` }); break; }
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
          if (raw.edges.length === before) skipped.push({ op: op.op, reason: "unknown-edge", message: `エッジ「${op.from}→${op.to}」が見つからず削除をスキップ（候補: ${edgesOf(raw)}）。` });
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

/** One removeNode/removeEdge whose target isn't referenced by the instruction — a possible mistarget. */
export interface DeleteIntentAdvisory {
  op: "removeNode" | "removeEdge";
  message: string; // human, Japanese — ready to show as an advisory (never blocks)
}

/**
 * Cross-check DELETE ops against the user's instruction (ADR-0018/0019). A weak model told to delete a
 * NON-existent element may hallucinate the nearest existing one (observed: "Cacheを削除" → removeEdge
 * api→redis). applyDiagramEditOps validates op SHAPE, not INTENT, so that op applies cleanly and only a
 * YAML diff hints at it. Here, for each removeNode/removeEdge, if the deleted element's id/label is NOT
 * referenced anywhere in the instruction, we flag it — advisory-only, surfaced at the adoption gate so
 * the reviewer catches the mistarget before 採用. Substring match only (NFKC+lowercase, id · full label ·
 * label words ≥2 chars); no fuzzy lib in v1 (kept advisory so a false positive never blocks a real delete).
 * The instruction is a plain string arg (lives in the UI layer) → this stays R2-pure.
 */
export function checkDeleteIntent(slide: SlideIR, ops: DiagramEditOps, instruction: string): DeleteIntentAdvisory[] {
  const inst = instruction.trim();
  if (!inst) return [];
  const raw = readFigureRaw(slide);
  if (!raw) return [];
  const nodes = raw.nodes ?? [];
  const labelOf = (id: string): string => {
    const n = nodes.find((x) => String(x.id) === id);
    return n && typeof n.label === "string" ? n.label : "";
  };
  const norm = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const hay = norm(inst);
  // "referenced" = the id, the full label, or any label word appears in the instruction. Candidates
  // shorter than 2 normalized chars are ignored (a 1-char id like "a" substring-matches almost any
  // sentence → it would mask a real mistarget), so the advisory still fires for those.
  const referenced = (...cands: string[]): boolean =>
    cands.some((c) => {
      if (!c) return false;
      const nc = norm(c);
      if (nc.length >= 2 && hay.includes(nc)) return true;
      return c.split(/\s+/).some((w) => norm(w).length >= 2 && hay.includes(norm(w)));
    });
  const out: DeleteIntentAdvisory[] = [];
  for (const op of ops) {
    if (op.op === "removeNode") {
      const label = labelOf(op.id);
      if (!referenced(op.id, label))
        out.push({ op: "removeNode", message: `削除対象「${label || op.id}」は指示文に見当たりません — 意図と違う削除の可能性があります（採用前に確認してください）。` });
    } else if (op.op === "removeEdge") {
      const fl = labelOf(op.from), tl = labelOf(op.to);
      const edge = (raw.edges ?? []).find((e) => String(e.from) === op.from && String(e.to) === op.to);
      const el = edge && typeof edge.label === "string" ? edge.label : "";
      if (!referenced(op.from, op.to, fl, tl, el))
        out.push({ op: "removeEdge", message: `削除対象のエッジ「${fl || op.from}→${tl || op.to}」は指示文に見当たりません — 意図と違う削除の可能性があります（採用前に確認してください）。` });
    }
  }
  return out;
}
