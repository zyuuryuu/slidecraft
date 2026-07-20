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
  reason: "no-figure" | "unparseable-figure" | "unknown-node" | "unknown-edge" | "duplicate-id";
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
 * Sequence figures index activations/fragments/notes into the ORDERED message (edge) list, and
 * activations/notes name a participant (node id). When messages are removed those indices must be
 * RE-BASED and refs to a removed message / removed participant DROPPED — otherwise the figure keeps
 * orphan / out-of-range refs that pass schema validation (schema treats them as free string/number)
 * but corrupt the renderer. `keptOldIndices[newIdx] = oldIdx` lists the surviving message positions
 * in order; `oldEdgeCount` is the message count BEFORE removal (needed to re-base a note's `at` when
 * it sits at the "after the last message" sentinel — `at === oldEdgeCount` — not on a real message).
 * No-op unless sequence.
 */
function rebaseSequenceRefs(raw: RawDiagram, keptOldIndices: number[], removedNodeIds: Set<string>, oldEdgeCount: number): void {
  if (raw.type !== "sequence") return;
  const toNew = new Map<number, number>();
  keptOldIndices.forEach((oldIdx, newIdx) => toNew.set(oldIdx, newIdx));
  const remap = (i: unknown): number | null => (typeof i === "number" && toNew.has(i) ? (toNew.get(i) as number) : null);
  // A note's `at` may equal oldEdgeCount (the "after the last message" sentinel, #270) — always
  // valid, tracking the new end; any other value is valid only if that message survived.
  const remapAt = (i: unknown): number | null => {
    if (typeof i !== "number") return null;
    return i === oldEdgeCount ? keptOldIndices.length : remap(i);
  };
  if (Array.isArray(raw.activations)) {
    raw.activations = (raw.activations as Array<Record<string, unknown>>).filter((a) => {
      if (removedNodeIds.has(String(a.participant))) return false; // participant gone
      const f = remap(a.from), t = remap(a.to);
      if (f === null || t === null) return false; // spans a removed message
      a.from = f; a.to = t; return true;
    });
  }
  if (Array.isArray(raw.fragments)) {
    raw.fragments = (raw.fragments as Array<Record<string, unknown>>).filter((fr) => {
      const f = remap(fr.from), t = remap(fr.to);
      if (f === null || t === null) return false;
      fr.from = f; fr.to = t;
      if (Array.isArray(fr.dividers)) {
        fr.dividers = (fr.dividers as Array<Record<string, unknown>>)
          .filter((dv) => remap(dv.at) !== null)
          .map((dv) => ({ ...dv, at: remap(dv.at) as number }));
      }
      return true;
    });
  }
  if (Array.isArray(raw.notes)) {
    raw.notes = (raw.notes as Array<Record<string, unknown>>).filter((nt) => {
      const participants = Array.isArray(nt.participants) ? (nt.participants as unknown[]) : [];
      if (participants.some((p) => removedNodeIds.has(String(p)))) return false; // a referenced participant is gone
      const at = remapAt(nt.at);
      if (at === null) return false; // pinned to a removed message
      nt.at = at; return true;
    });
  }
}

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
  // The slide HAS a figure but it can't be parsed (schema-invalid: numeric id, unknown shape, malformed
  // YAML …). applyToFigure would return the slide identically → the edit vanishes with NO signal. Report
  // it as skipped so the loss is never silent (matches the no-figure branch). ADR-0018/0019.
  if (readFigureRaw(slide) === null) {
    return { slide, skipped: ops.map((op) => ({ op: op.op, reason: "unparseable-figure" as const, message: "図の定義を解析できないため編集をスキップしました（図の記述に不正がある可能性）。" })) };
  }
  // `dirty` tracks whether any op ACTUALLY changed the figure. applyToFigure always re-dumps via
  // dumpDiagramLikeSource→yaml.dump (data-lossless but NOT formatting-identical), so a pure no-op
  // (e.g. removeNode of an absent id, or nodeUpdate to the same value) would otherwise yield a
  // re-serialized figure that differs by a line → a spurious "-0 +1" diff / a silent reformat on adopt.
  // If nothing changed we return the ORIGINAL slide byte-identical.
  let dirty = false;
  const out = applyToFigure(slide, (_spec, raw) => {
    raw.nodes ??= [];
    raw.edges ??= [];
    for (const op of ops) {
      switch (op.op) {
        case "nodeUpdate": {
          const n = raw.nodes.find((x) => String(x.id) === op.id);
          if (!n) { skipped.push({ op: op.op, reason: "unknown-node", message: `ノード「${op.id}」が見つからず更新をスキップ（候補: ${idsOf(raw)}）。` }); break; }
          if (op.label !== undefined && n.label !== op.label) { n.label = op.label; dirty = true; }
          if (op.sublabel !== undefined && n.sublabel !== op.sublabel) { n.sublabel = op.sublabel; dirty = true; }
          if (op.value !== undefined && n.value !== op.value) { n.value = op.value; dirty = true; }
          if (op.icon !== undefined && n.icon !== op.icon) { n.icon = op.icon; dirty = true; }
          if (op.shape !== undefined && n.shape !== op.shape) { n.shape = op.shape; dirty = true; }
          break;
        }
        case "addNode": {
          if (raw.nodes.some((x) => String(x.id) === op.id)) { skipped.push({ op: op.op, reason: "duplicate-id", message: `ノード id「${op.id}」は既に存在するため追加をスキップしました。` }); break; }
          raw.nodes.push({ id: op.id, label: op.label, ...(op.shape ? { shape: op.shape } : {}), ...(op.group ? { group: op.group } : {}) });
          dirty = true;
          break;
        }
        case "removeNode": {
          const before = raw.nodes.length;
          const edgesBefore = raw.edges.length;
          raw.nodes = raw.nodes.filter((x) => String(x.id) !== op.id);
          const keptEdgeIdx: number[] = [];
          raw.edges = raw.edges.filter((e, i) => {
            const keep = String(e.from) !== op.id && String(e.to) !== op.id; // drop now-dangling edges
            if (keep) keptEdgeIdx.push(i);
            return keep;
          });
          if (raw.nodes.length === before) skipped.push({ op: op.op, reason: "unknown-node", message: `ノード「${op.id}」が見つからず削除をスキップ（候補: ${idsOf(raw)}）。` });
          if (raw.nodes.length !== before || raw.edges.length !== edgesBefore) {
            rebaseSequenceRefs(raw, keptEdgeIdx, new Set([op.id]), edgesBefore); // sequence: drop orphan participant + rebase message indices
            dirty = true;
          }
          break;
        }
        case "edgeUpdate": {
          const e = raw.edges.find((x) => String(x.from) === op.from && String(x.to) === op.to);
          if (!e) { skipped.push({ op: op.op, reason: "unknown-edge", message: `エッジ「${op.from}→${op.to}」が見つからず更新をスキップ（候補: ${edgesOf(raw)}）。` }); break; }
          if (op.label !== undefined && e.label !== op.label) { e.label = op.label; dirty = true; }
          if (op.relation !== undefined && e.relation !== op.relation) { e.relation = op.relation; dirty = true; }
          break;
        }
        case "addEdge": {
          raw.edges.push({ from: op.from, to: op.to, ...(op.label ? { label: op.label } : {}) });
          dirty = true;
          break;
        }
        case "removeEdge": {
          const before = raw.edges.length;
          const keptEdgeIdx: number[] = [];
          raw.edges = raw.edges.filter((e, i) => {
            const keep = !(String(e.from) === op.from && String(e.to) === op.to);
            if (keep) keptEdgeIdx.push(i);
            return keep;
          });
          if (raw.edges.length === before) skipped.push({ op: op.op, reason: "unknown-edge", message: `エッジ「${op.from}→${op.to}」が見つからず削除をスキップ（候補: ${edgesOf(raw)}）。` });
          else { rebaseSequenceRefs(raw, keptEdgeIdx, new Set(), before); dirty = true; } // sequence: rebase message indices
          break;
        }
        case "setDirection": {
          if (raw.direction !== op.direction) { raw.direction = op.direction; dirty = true; }
          break;
        }
      }
    }
  });
  // No real change → keep the ORIGINAL slide (identity), so figureFence(before)===figureFence(after)
  // and adopting a no-op never silently reformats the figure YAML.
  return { slide: dirty ? out : slide, skipped };
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
  // Fold space/hyphen/underscore to a SINGLE space (not empty): the ASCII word-boundary check in refIn
  // needs separators to survive, else an instruction like "remove the db node" fuses to "removethedbnode"
  // and a correctly-named id ("db") is embedded in a letter run → false "not referenced" advisory.
  const norm = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const hay = norm(inst);
  // Does the instruction reference `needle`? A pure-ASCII needle must match at a WORD boundary (so a
  // short id like "sql" is NOT counted merely because it is a substring of "postgresql"); a needle with
  // any non-ASCII char (Japanese) is matched by substring (CJK has no word boundaries). No regex
  // lookbehind — older webviews (Tauri/WKWebView) lack it — so boundaries are checked manually.
  const refIn = (needle: string): boolean => {
    if (needle.length < 2) return false; // a 1-char id would match almost any sentence
    if (!/^[a-z0-9]+$/.test(needle)) return hay.includes(needle);
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
      const before = i > 0 ? hay[i - 1] : "";
      const after = i + needle.length < hay.length ? hay[i + needle.length] : "";
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    }
    return false;
  };
  // "referenced" = the id, the full label, or any label word appears in the instruction.
  const referenced = (...cands: string[]): boolean =>
    cands.some((c) => {
      if (!c) return false;
      if (refIn(norm(c))) return true;
      return c.split(/[\s_-]+/).some((w) => refIn(norm(w)));
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

/**
 * Deterministic ops-bias nudge for the single-retry self-repair (ADR-0019 ①, Option A). When a figure
 * edit drifted to full-Markdown (the model chose format A and lost numbers/language → rolled back), we
 * re-ask ONCE for ONLY the ops (format B). The nudge is HARNESS-authored (not the model's): it restates
 * the instruction, lists the REAL node ids so the model doesn't fuzzy-match, forbids full-Markdown, and
 * pins numbers/language. Pure (R2): `slide` in, string out.
 */
export function buildOpsRetryInstruction(slide: SlideIR, instruction: string): string {
  const raw = readFigureRaw(slide);
  const ids = (raw?.nodes ?? []).map((n) => String(n.id)).join(", ") || "（なし）";
  return `${instruction.trim()}

【重要・再指示】前回の出力はスライド全文の Markdown で、図以外の数値・言語まで変わってしまいました。今回は図の部分編集として、変更する図要素だけの ops JSON 配列（形式B）のみを返してください（全文 Markdown は返さない）。既存ノードid: ${ids}。指示に無いノード・エッジ・数値・固有名詞は変更せず、入力の言語も保ってください。`;
}
