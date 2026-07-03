/**
 * slide-roles.ts — the SINGLE SOURCE OF TRUTH for the canonical SlideIR placeholder-role convention.
 *
 * The pipeline speaks in TWO placeholder namespaces:
 *  - the CANONICAL namespace (this file): the idxs the Markdown parser/serializer use inside a SlideIR
 *    — title = 0 (title/closing layouts) or 15 (all others), subtitle = 1 or 16, meta = 10/11/12.
 *  - the TEMPLATE's REAL namespace: whatever idxs a given master actually uses — reconciled downstream
 *    by role-binding (bindContentByRole / expandGroups). Nothing here touches that layer.
 *
 * This convention used to be COPIED into md-slide-parser, md-serializer, ai-reconcile and ai-validate.
 * That duplication is a drift hazard: changing the format in one place silently desyncs the AI guards
 * from the parser (a real bug we hit: reconcile judged the title namespace from the layout NAME only,
 * while the parser also promotes a slide to the title namespace when it carries meta fields). Centralize
 * it here so every module derives the convention from one place. Pure logic (R2): no DOM / Tauri.
 */

/** Title/Closing layouts use the ctrTitle namespace (title idx 0, subtitle idx 1). */
export function isTitleLayout(layout: string): boolean {
  return layout.startsWith("Title.") || layout.startsWith("Closing.");
}

/** Canonical title/subtitle idx by namespace. */
export const TITLE_NS = { title: "0", subtitle: "1" } as const;
export const CONTENT_NS = { title: "15", subtitle: "16" } as const;

/** Category / Date / Footer → meta placeholder idx (title-slide metadata), and the reverse. */
export const META_FIELDS = [
  { name: "Category", idx: "10" },
  { name: "Date", idx: "11" },
  { name: "Footer", idx: "12" },
] as const;
/** All meta placeholder idxs (Category/Date/Footer). */
export const META_IDXS: readonly string[] = META_FIELDS.map((f) => f.idx);
/** Meta field name (case-insensitive) → its idx, e.g. "category" → "10". */
export function metaFieldIdx(name: string): string | undefined {
  return META_FIELDS.find((f) => f.name.toLowerCase() === name.toLowerCase())?.idx;
}
/** Meta idx → its capitalized field name, e.g. "10" → "Category". */
export function metaIdxToField(idx: string): string | undefined {
  return META_FIELDS.find((f) => f.idx === idx)?.name;
}

/**
 * A slide is in the TITLE namespace when its layout is a Title/Closing layout OR it carries meta
 * fields (Category/Date/Footer). This is the EXACT rule the parser applies at parse time — reconcile
 * must mirror it so it restores a dropped title into the same idx the parser would have used.
 */
export function isTitleNamespace(layout: string, hasMetaFields: boolean): boolean {
  return isTitleLayout(layout) || hasMetaFields;
}

/** The title/subtitle placeholder idx for a slide, given its layout and whether it has meta fields. */
export function titleSubtitleIdx(layout: string, hasMetaFields: boolean): { title: string; subtitle: string } {
  return isTitleNamespace(layout, hasMetaFields) ? TITLE_NS : CONTENT_NS;
}
