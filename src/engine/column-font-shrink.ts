/**
 * column-font-shrink.ts — 本文枠を N 列に分割したとき、各段（lvl1〜）の文字サイズをどれだけ下げるかの規則（#568 段 2）。
 *
 * 規則はここ 1 か所だけに置く（R8）。使う側はレイアウト合成（layout-augment.ts）の lstStyle 書き込みと、
 * その確認文・テスト。統括裁定（2026-11-07）:
 *  - 既定 "steps": PowerPoint のフォントサイズ一覧で 2 列 −1 段・3 列 −2 段。
 *  - 選択肢 "ratio": 2 列 ×0.875・3 列 ×0.75 を 0.5pt 単位に切り下げ。
 *  - 共通: 0.5pt 単位・lvl1 の下限 9pt（元が 9pt 未満なら元の値を超えない）。lvl2 以降も同じ規則。
 *
 * 純粋計算のみ（R2）。
 */

export type ShrinkRule = "steps" | "ratio";
export type ColumnCount = 2 | 3;

/** PowerPoint（日本語版）の「フォントサイズ」一覧。−1 段 ＝ この一覧で今の値より小さい最大の値。
 *  統括裁定の値。英語版には 10.5 が無いという報告もあり、版による差は PowerPoint 実機で要確認。 */
export const POWERPOINT_FONT_SIZES: readonly number[] = [
  8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96,
];

/** 列数ごとの縮小量: steps は下げる段数、ratio は倍率。 */
export const COLUMN_SHRINK: Readonly<Record<ShrinkRule, Readonly<Record<ColumnCount, number>>>> = {
  steps: { 2: 1, 3: 2 },
  ratio: { 2: 0.875, 3: 0.75 },
};

/** lvl1（本文の 1 段目）の下限 pt。 */
export const LVL1_FLOOR_PT = 9;

export const DEFAULT_SHRINK_RULE: ShrinkRule = "steps";

const floorHalf = (pt: number) => Math.floor(pt * 2 + 1e-9) / 2;

/** `pt` を一覧で `k` 段下げた値（今の値より小さい一覧の値を k 個たどる）。一覧の最小値より下へは行かない。 */
export function stepDown(pt: number, k: number): number {
  const lower = POWERPOINT_FONT_SIZES.filter((v) => v < pt - 1e-9);
  if (lower.length === 0 || k <= 0) return k <= 0 ? pt : floorHalf(pt);
  return lower[Math.max(0, lower.length - k)];
}

/**
 * 元の 1 枠で `pt` の段（`level` 1 = lvl1）を `columns` 列に分割したときのサイズ（pt・0.5 単位）。
 * 結果は元の値を超えない（縮小のみ）。
 */
export function columnFontSize(pt: number, columns: ColumnCount, rule: ShrinkRule, level: number): number {
  const amount = COLUMN_SHRINK[rule][columns];
  let out = rule === "steps" ? stepDown(pt, amount) : floorHalf(pt * amount);
  if (level === 1) out = Math.max(out, Math.min(LVL1_FLOOR_PT, floorHalf(pt)));
  return Math.min(out, floorHalf(pt));
}
