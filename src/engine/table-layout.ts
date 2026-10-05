/**
 * table-layout.ts — content-proportional column widths + numeric-column detection for
 * native tables (#138). Pure logic (R2): the SOLE place this is computed (R8) — both
 * table-ooxml (PPTX export) and SlidePreview (HTML preview) consume it so column widths
 * and numeric right-align never drift between what's shown and what's exported.
 */

import { inlinePlainText } from "./md-inline";

const EMU_PER_INCH = 914400;

// East-Asian wide ranges (CJK ideographs, kana, hangul, fullwidth forms, …) count as 2
// display columns; everything else counts as 1. Good enough for column-weight purposes.
const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
];

function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    w += WIDE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) ? 2 : 1;
  }
  return w;
}

const NUMERIC_RE = /^[+-]?[¥$€£]?[\d,]+(\.\d+)?%?$/;

// Cells are measured by their VISIBLE text (#395): inline markers (`**`, `` ` ``, `[…](url)` …) are
// not drawn, so they must not widen a column or break numeric detection. Markup-free → unchanged.
function isNumericCell(cell: string): boolean {
  const t = inlinePlainText(cell).trim();
  return t === "" || NUMERIC_RE.test(t);
}

function colCount(rows: string[][]): number {
  return Math.max(1, ...rows.map((r) => r.length));
}

/** True when every non-empty BODY cell (header excluded) in the column looks numeric. */
export function computeNumericColumns(rows: string[][], header: boolean): boolean[] {
  const ncol = colCount(rows);
  const body = header ? rows.slice(1) : rows;
  return Array.from({ length: ncol }, (_, c) => {
    const cells = body.map((r) => r[c] ?? "");
    return cells.some((cell) => cell.trim() !== "") && cells.every(isNumericCell);
  });
}

// No column starves below 8% of the box width or dominates past 50% of it, regardless
// of how extreme the content-width ratio is.
const MIN_FRACTION = 0.08;
const MAX_FRACTION = 0.5;

/**
 * Content-proportional column widths in EMU, summing EXACTLY to boxWidthIn's EMU
 * equivalent (the last column absorbs the rounding remainder). Each column's weight is
 * its widest cell (CJK-aware display width, header included), clamped to
 * [MIN_FRACTION, MAX_FRACTION] of the total before the final split.
 */
export function computeColumnWidthsEmu(rows: string[][], boxWidthIn: number): number[] {
  const ncol = colCount(rows);
  const weights = Array.from({ length: ncol }, (_, c) =>
    Math.max(1, ...rows.map((r) => displayWidth(inlinePlainText(r[c] ?? "")))),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  const clamped = weights.map((w) => Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, w / total)));
  const clampedTotal = clamped.reduce((a, b) => a + b, 0);

  const boxWidthEmu = Math.round(boxWidthIn * EMU_PER_INCH);
  const widths = clamped.map((f) => Math.round((f / clampedTotal) * boxWidthEmu));
  widths[widths.length - 1] += boxWidthEmu - widths.reduce((a, b) => a + b, 0);
  return widths;
}

/** A native table cell's text metrics — the font size and cell margins table-ooxml WRITES, and the
 *  overflow estimate below READS (#436, R8: one definition, so the estimate can't drift from export). */
export const TABLE_CELL = { fontPt: 11, marLREmu: 91440, marTBEmu: 45720 } as const;

// PowerPoint's single line spacing ≈ 1.2 × the font size; one displayWidth column ≈ half an em.
const LINE_SPACING = 1.2;
const PT_PER_INCH = 72;

/** TABLE_CELL's margins in INCHES plus the line spacing the row-height estimate assumes — the
 *  preview derives its td padding / line-height from these (#443, R8: same numbers table-ooxml
 *  writes in EMU, so a table row is the same height on screen and in the export's estimate). */
export const TABLE_CELL_IN = {
  padLR: TABLE_CELL.marLREmu / EMU_PER_INCH,
  padTB: TABLE_CELL.marTBEmu / EMU_PER_INCH,
  lineSpacing: LINE_SPACING,
} as const;

/**
 * #436: each row's ESTIMATED rendered height (inches) in a table `boxWidthIn` wide. PowerPoint grows a
 * row to fit its text (table-ooxml's nominal `box.h / rows` is only a floor), so the real height is the
 * tallest cell's wrapped line count × line height + the top/bottom cell margins. Wrapping reuses the
 * SAME column widths the export assigns (computeColumnWidthsEmu) and the SAME CJK-aware displayWidth
 * on the VISIBLE text (R8 — no second width calculation). An estimate, not a layout: glyph widths are
 * averaged (CJK = 1 em, else ½ em) and word-boundary wrapping is ignored. Pure (R2).
 */
export function estimateTableRowHeightsIn(rows: string[][], boxWidthIn: number): number[] {
  const widths = computeColumnWidthsEmu(rows, boxWidthIn);
  const colPt = TABLE_CELL.fontPt / 2;
  const lineIn = (TABLE_CELL.fontPt * LINE_SPACING) / PT_PER_INCH;
  const padIn = (2 * TABLE_CELL.marTBEmu) / EMU_PER_INCH;
  const perLine = widths.map((w) => Math.max(1, Math.floor((((w - 2 * TABLE_CELL.marLREmu) / EMU_PER_INCH) * PT_PER_INCH) / colPt)));
  return rows.map((r) => {
    const lines = perLine.map((cap, c) => Math.max(1, Math.ceil(displayWidth(inlinePlainText(r[c] ?? "")) / cap)));
    return Math.max(1, ...lines) * lineIn + padIn;
  });
}
