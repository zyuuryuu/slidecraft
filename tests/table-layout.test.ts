/**
 * table-layout.test.ts — #138 (content-proportional column widths + numeric right-align)
 * pure-logic tests for the shared engine function, written before the implementation (R3).
 */
import { describe, it, expect } from "vitest";
import { computeColumnWidthsEmu, computeNumericColumns } from "../src/engine/table-layout";

const EMU_PER_INCH = 914400;

// The risk-register table from #138: "#" (1 digit) / リスク / 影響 / 発生確率 (2 chars) /
// 対応状況 (20+ chars) — equal split wastes width on "#"/"発生確率" and crams "対応状況".
const RISK_TABLE = [
  ["#", "リスク", "影響", "発生確率", "対応状況"],
  ["1", "データ漏洩", "大", "20%", "アクセス制御の見直しとログ監査の強化を継続的に実施中"],
  ["2", "納期遅延", "中", "40%", "外部ベンダーとの週次進捗確認を導入し早期検知を徹底"],
  ["3", "予算超過", "小", "10%", "月次コスト精査と承認フローの厳格化で抑制を図る"],
];

describe("computeColumnWidthsEmu", () => {
  it("produces non-uniform widths where '#' < '対応状況'", () => {
    const widths = computeColumnWidthsEmu(RISK_TABLE, 8);
    expect(widths[0]).toBeLessThan(widths[4]);
    // not an equal 5-way split
    const equalShare = Math.round((8 * EMU_PER_INCH) / 5);
    expect(widths.some((w) => Math.abs(w - equalShare) > 1000)).toBe(true);
  });

  it("sums exactly to the box width in EMU", () => {
    const widths = computeColumnWidthsEmu(RISK_TABLE, 8);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(Math.round(8 * EMU_PER_INCH));
  });

  it("falls back to a single equal-width column for a raw single-cell table", () => {
    const widths = computeColumnWidthsEmu([["only"]], 3);
    expect(widths).toEqual([Math.round(3 * EMU_PER_INCH)]);
  });

  it("handles ragged rows (short rows padded conceptually) without throwing", () => {
    expect(() => computeColumnWidthsEmu([["a", "b", "c"], ["x"]], 5)).not.toThrow();
  });
});

describe("computeNumericColumns", () => {
  it("flags '#' and '発生確率' as numeric, not 'リスク'/'影響'/'対応状況'", () => {
    const numeric = computeNumericColumns(RISK_TABLE, true);
    expect(numeric).toEqual([true, false, false, true, false]);
  });

  it("does not flag a column with any non-numeric body cell (mixed content)", () => {
    const rows = [
      ["プラン", "月額"],
      ["Free", "¥0"],
      ["Enterprise", "要相談"], // non-numeric body cell → column is NOT numeric
    ];
    expect(computeNumericColumns(rows, true)).toEqual([false, false]);
  });

  it("treats blank cells as non-disqualifying but requires at least one non-empty cell", () => {
    const rows = [["A", "B"], ["1", ""], ["2", ""]];
    expect(computeNumericColumns(rows, true)).toEqual([true, false]);
  });

  it("without a header row, all rows are body rows", () => {
    expect(computeNumericColumns([["1", "a"], ["2", "b"]], false)).toEqual([true, false]);
  });
});
