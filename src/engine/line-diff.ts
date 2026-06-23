/**
 * line-diff.ts — minimal line-level diff (LCS) for showing an AI edit as
 * before→after, so a fix is never applied blind: the user SEES what changed —
 * especially any line the model dropped (a "del" with no matching "add").
 *
 * Pure logic (R2): no DOM / Tauri.
 */

export type DiffRow = { type: "same" | "add" | "del"; text: string };

/** Diff two texts by line. Rows are in display order; "del" = only in before,
 *  "add" = only in after, "same" = unchanged. */
export function lineDiff(before: string, after: string): DiffRow[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length;
  const n = b.length;

  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: a[i] });
      i++;
    } else {
      rows.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) rows.push({ type: "del", text: a[i++] });
  while (j < n) rows.push({ type: "add", text: b[j++] });
  return rows;
}

/** Count of dropped / added lines — for a one-line "−N +M" summary. */
export function diffStat(rows: DiffRow[]): { del: number; add: number } {
  return {
    del: rows.filter((r) => r.type === "del").length,
    add: rows.filter((r) => r.type === "add").length,
  };
}
