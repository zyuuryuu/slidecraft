/**
 * nested-level-font.ts — 入れ子箇条（lvl2 以降）のフォントサイズを lvl1 から段階縮小する規則（#103・#574）。
 *
 * この規則は 1 か所だけに置く（R8）。使う側は 2 つ:
 *  - template-loader: 本文枠や master が入れ子段のサイズを明示しないときのプレビュー用の値。
 *  - template-writer: 生成テンプレの master bodyStyle に書く lvl2〜5 の sz。
 * 両者が同じ関数を使うので、生成テンプレではプレビューと PPTX の入れ子段のサイズが一致する。
 */

/** 1 段ごとの縮小率（約 12%/段）。 */
export const NESTED_LEVEL_STEP = 0.88;
/** 下限: lvl1 サイズに対する比率。 */
export const NESTED_LEVEL_FLOOR = 0.6;

/**
 * `level1Size`（pt）の本文で、入れ子段 `level`（0 = lvl1 そのもの、1 = lvl2 …）のサイズ（pt）。
 * OOXML の sz は 1/100 pt 単位の整数なので、0.01pt に丸めて返す（writer が書く値と loader が
 * 読み戻す値を完全一致させるため）。
 */
export function nestedLevelFontSize(level1Size: number, level: number): number {
  const pt = Math.max(level1Size * NESTED_LEVEL_STEP ** level, level1Size * NESTED_LEVEL_FLOOR);
  return Math.round(pt * 100) / 100;
}
