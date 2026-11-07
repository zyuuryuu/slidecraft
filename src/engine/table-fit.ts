/**
 * table-fit.ts — the ONE "does this table fit this box" judgment (#436 → #444). Pure (R2).
 *
 * Read by deck-diagnostics (the `table-overflow` warn, #436) AND by the auto layout pick
 * (template-catalog.pickLayout demotes a layout whose box the table overflows, #444) — one definition,
 * so the pick can never choose a box the warn would then flag as "fits", or vice versa (R8).
 * The row-height estimate itself is table-layout's estimateTableRowHeightsIn (no second estimate).
 */
import { estimateTableRowHeightsIn } from "./table-layout";

/** The table's estimated rendered height vs a box — undefined when it fits. `fit` = how many leading
 *  rows the estimate fits in the box (header included). */
export function tableOverflow(rows: string[][], box: { w: number; h: number }): { fit: number } | undefined {
  const heights = estimateTableRowHeightsIn(rows, box.w);
  if (heights.reduce((a, b) => a + b, 0) <= box.h) return undefined;
  let used = 0;
  const fit = heights.findIndex((h) => (used += h) > box.h);
  return { fit };
}
