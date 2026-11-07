/**
 * body-ordinal.ts — a visual's `placeholderIdx` ("1", "2", …) → its 0-based BODY ordinal. The one
 * parse shared by visual-placement.nthBody (where export/preview place a visual) and the auto pick's
 * table-fit term (template-catalog.pickLayout, #444) — so both read the same box (R8). Leaf module
 * (no engine imports) so template-catalog can use it without an import cycle. Pure (R2).
 */
export function bodyOrdinalIndex(placeholderIdx: string): number {
  return Math.max(1, parseInt(placeholderIdx) || 1) - 1;
}
