/**
 * field-edit-ops.ts — #106 P2 / ADR-0019: placeholder TEXT ops. The model rewrites only the field(s)
 * it changes — `[{ "op": "setField", "idx": "<idx>", "text": "<the field's new text>" }]` — and the
 * engine merges them through the SAME primitive the GUI field editor uses (SlideEditor.updatePlaceholder:
 * applyFieldEdit + textToParagraphs, R8). Every other placeholder, the figure, the table, the layout pin
 * stay verbatim (the whole-slide Markdown round-trip the full-text path takes is where drift came from).
 *
 * Scope: setField rewrites a placeholder the slide ALREADY carries (blank text clears it, as in the
 * editor). An idx the slide does not carry is skipped and announced — filling an empty layout field
 * still goes through the full Markdown edit, where the binding decides the idx.
 *
 * Sibling of diagram-edit-ops.ts (figure content) and design-intent.ts (arrangement): the three op
 * vocabularies are disjoint, so a reply matches at most one parser. Pure logic (R2): no DOM / Tauri.
 */
import { z } from "zod";
import type { SlideIR } from "./slide-schema";
import { applyFieldEdit } from "./placeholder-binding";
import { paragraphsToText, textToParagraphs } from "./field-text";
import { parseJsonLoose } from "./json-salvage";

const SetFieldOp = z.object({
  op: z.literal("setField"),
  // Placeholder idxs are strings in the SlideIR ("15", "1", "callout"); a model often drops the quotes.
  idx: z.union([z.string().min(1), z.number().int().nonnegative()]).transform(String),
  text: z.string(),
});
export const FieldEditOpsSchema = z.array(SetFieldOp).min(1);
export type FieldEditOps = z.infer<typeof FieldEditOpsSchema>;
export type FieldEditOp = FieldEditOps[number];

/** A setField that didn't take effect — surfaced never-silently (mirrors SkippedDiagramOp). */
export interface SkippedFieldOp {
  op: "setField";
  idx: string;
  reason: "unknown-idx";
  message: string; // human, Japanese — ready to show as a notice
}

/** The bare JSON array a whole reply consists of (optionally ```-fenced), or null. Same whole-string
 *  rule as parseDiagramEditOps / parseDesignIntent: prose that QUOTES an array is not an ops reply.
 *  Shared with chart-edit-ops (#106 P3) so both TEXT and DATA ops detect a reply the same way (R8). */
export function bareArray(raw: string): unknown[] | null {
  let t = raw.trim();
  const fence = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fence) t = fence[1].trim();
  if (!(t.startsWith("[") && t.endsWith("]"))) return null;
  const r = parseJsonLoose(t);
  return r.ok && Array.isArray(r.value) && r.value.length > 0 ? r.value : null;
}

/** Detect a setField ops array in raw model output. null → not a (valid) field-ops reply. */
export function parseFieldEditOps(raw: string): FieldEditOps | null {
  const arr = bareArray(raw);
  if (!arr) return null;
  const d = FieldEditOpsSchema.safeParse(arr);
  return d.success ? d.data : null;
}

/**
 * A reply that is a bare array naming `setField` yet fails the schema (missing text, mixed with other
 * op kinds, …). It is not applied as ops; the caller falls back to the full-text path and shows this
 * notice so the fallback is never silent. null when the reply is valid ops or not a setField array.
 */
export function malformedFieldOpsNotice(raw: string): string | null {
  const arr = bareArray(raw);
  if (!arr || !arr.some((o) => typeof o === "object" && o !== null && (o as { op?: unknown }).op === "setField")) return null;
  if (FieldEditOpsSchema.safeParse(arr).success) return null;
  return "[opsフォールバック] 文面の部分編集（setField ops）の形式が不正なため、スライド全文の編集として処理しました。各 op には idx と text が必要で、1 回の返答に他の種類の op を混ぜられません。";
}

const idxList = (slide: SlideIR): string => slide.placeholders.map((p) => p.idx).join(", ") || "なし";

/**
 * Merge setField ops in order, each through applyFieldEdit(textToParagraphs(text)) — exactly the field
 * editor's write. Untouched placeholders are the same objects (byte-identical). An idx the slide does
 * not carry (at that point in the batch) is skipped and reported; the batch never aborts. When nothing
 * applied, the ORIGINAL slide object is returned so there is no spurious diff.
 */
export function applyFieldEditOps(slide: SlideIR, ops: FieldEditOps): { slide: SlideIR; skipped: SkippedFieldOp[] } {
  const skipped: SkippedFieldOp[] = [];
  let placeholders = slide.placeholders;
  let dirty = false;
  for (const o of ops) {
    if (!placeholders.some((p) => p.idx === o.idx)) {
      skipped.push({
        op: "setField", idx: o.idx, reason: "unknown-idx",
        message: `setField: idx "${o.idx}" はこのスライドにないため適用しませんでした（存在する idx: ${idxList({ ...slide, placeholders })}）`,
      });
      continue;
    }
    placeholders = applyFieldEdit(placeholders, o.idx, textToParagraphs(o.text));
    dirty = true;
  }
  return { slide: dirty ? { ...slide, placeholders } : slide, skipped };
}

/** The GUI's setField branch (handleApplySlide / previewSlideEdit): ops → merged slide + notices;
 *  malformed setField → fall back to full text with a notice; anything else → null (other routes). */
export type FieldEditRoute =
  | { kind: "ops"; slide: SlideIR; notices: string[] }
  | { kind: "fallback"; notice: string };
export function routeFieldEdit(slide: SlideIR, raw: string): FieldEditRoute | null {
  const ops = parseFieldEditOps(raw);
  if (ops) {
    const r = applyFieldEditOps(slide, ops);
    return { kind: "ops", slide: r.slide, notices: r.skipped.map((s) => s.message) };
  }
  const notice = malformedFieldOpsNotice(raw);
  return notice ? { kind: "fallback", notice } : null;
}

/**
 * The idx list handed to the model alongside the slide Markdown, so a setField can name a real idx.
 * One line per text placeholder: `- idx "<idx>": "<text as the field editor shows it>"` (JSON-quoted,
 * so newlines are visible as \n). Empty when the slide carries no text placeholder.
 */
export function describeEditableFields(slide: SlideIR): string {
  return slide.placeholders.map((p) => `- idx ${JSON.stringify(p.idx)}: ${JSON.stringify(paragraphsToText(p.paragraphs))}`).join("\n");
}
