/**
 * field-rows.ts — the ONE mechanism behind slide-level FIELD ROWS (#397 `Takeaway:`, #398 `Source:`):
 *
 *   field row (`Name: value`, one Markdown line)  →  canonical content idx ("callout" / "source")
 *   →  the auto pick prefers a layout variant that HAS a slot for it (field-variant.ts)
 *   →  binding places it in that slot (placeholder-binding.ts Pass 0, via fieldSlotOf)
 *
 * Both rows are the same shape, so they share this table instead of two ad-hoc paths (R8). A new
 * row is one entry here + its slot-name pattern.
 *
 * Content side — the idx is NON-NUMERIC on purpose. An OOXML placeholder idx is always an unsigned
 * int, so "callout"/"source" can never collide with a template's own box (a numeric pick could: many
 * report masters carry a custom 注記 box at idx 13, 官公庁 uses 13/14 for 資料番号/メタ情報 — Pass-1
 * idx-exact would hijack them).
 *
 * Template side — a slot is recognized by its placeholder NAME, layered ON TOP of placeholderRole
 * (which is left untouched): Midnight's Callout.Top is role "body" and its Source.Bottom / 公文書's
 * 出典 are role "date" (footer-band geometry). Re-roling them would move bodyCount, the editor field
 * map and existing idx-2 content on pinned slides; recognizing the slot only when a row is present
 * keeps every row-less deck byte-identical.
 *
 * Pure logic (R2).
 */
import type { SlideIR } from "./slide-schema";
import type { PlaceholderInfo } from "./template-loader";

export type FieldKind = "callout" | "source";

interface FieldRow {
  /** The Markdown key (case-insensitive on parse; emitted in this spelling). */
  name: string;
  /** Canonical SlideIR content idx — also the slot kind and the binding role. */
  kind: FieldKind;
  /** Placeholder names that ARE this slot (canonical dotted names + known localized ones). */
  slotName: RegExp;
}

export const FIELD_ROWS: readonly FieldRow[] = [
  { name: "Takeaway", kind: "callout", slotName: /^(?:callout|takeaway)\b/i },
  { name: "Source", kind: "source", slotName: /^(?:source\b|出典)/i },
];

const ROW_RE = new RegExp(`^(${FIELD_ROWS.map((r) => r.name).join("|")}):\\s*(.+)$`, "i");

/** A Markdown line that is a field row → its kind + value (trimmed line in), else null. */
export function matchFieldRow(trimmed: string): { kind: FieldKind; value: string } | null {
  const m = trimmed.match(ROW_RE);
  if (!m) return null;
  const row = FIELD_ROWS.find((r) => r.name.toLowerCase() === m[1].toLowerCase())!;
  return { kind: row.kind, value: m[2] };
}

/** Is this SlideIR content idx a field row's canonical idx? */
export function isFieldIdx(idx: string): idx is FieldKind {
  return FIELD_ROWS.some((r) => r.kind === idx);
}

/** The Markdown key for a field kind ("callout" → "Takeaway"). */
export function fieldRowName(kind: FieldKind): string {
  return FIELD_ROWS.find((r) => r.kind === kind)!.name;
}

// Types that can never be a field slot (they carry their own fixed meaning).
const NON_SLOT_TYPE = /title|subtitle|pic|chart|tbl|sldnum/i;

/** The field slot a LAYOUT placeholder is (by its name), or undefined. Pure name/type test — it does
 *  not consult placeholderRole, so it can be used by the catalog without an import cycle. */
export function fieldSlotOf(ph: Pick<PlaceholderInfo, "name" | "type">): FieldKind | undefined {
  if (NON_SLOT_TYPE.test(ph.type)) return undefined;
  return FIELD_ROWS.find((r) => r.slotName.test(ph.name.trim()))?.kind;
}

/** The field kinds a slide carries (non-blank), in FIELD_ROWS order. */
export function slideFieldKinds(slide: SlideIR): FieldKind[] {
  return FIELD_ROWS.map((r) => r.kind).filter((k) =>
    slide.placeholders.some((p) => p.idx === k && p.paragraphs.some((pp) => pp.segments.some((s) => s.text.trim() !== ""))),
  );
}
