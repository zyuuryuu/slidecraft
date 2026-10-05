/**
 * table-overflow.test.ts — #436: a long GFM table (e.g. a 47-row glossary) renders, but PowerPoint grows
 * each row to fit its 11pt text, so the table runs far past its placeholder (and the slide's bottom
 * edge) — and diagnoseDeck said nothing, unlike long body text (body-overflow). Behavior is unchanged
 * here (no auto-split / font shrink); this locks a warn `table-overflow` (lever split) from an
 * estimate built on table-layout's EXISTING column-width computation (R8) and the SAME cell metrics
 * table-ooxml writes (TABLE_CELL).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";
import { computeColumnWidthsEmu, estimateTableRowHeightsIn, TABLE_CELL } from "../src/engine/table-layout";
import { tableGraphicFrameXml } from "../src/engine/table-ooxml";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

/** A glossary table of `n` rows INCLUDING the header row. */
function glossary(n: number, desc = (i: number) => `説明テキスト${i}`): string {
  const body = Array.from({ length: n - 1 }, (_, i) => `| 用語${i} | ${desc(i)} |`).join("\n");
  return `# 用語集\n\n| 用語 | 説明 |\n|---|---|\n${body}`;
}

describe("diagnoseDeck — table-overflow (#436)", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(MIDNIGHT));
    catalog = buildCatalog(tpl);
  });
  const overflows = (md: string) => diagnoseDeck(parseMd(md), catalog, tpl.layouts).filter((i) => i.id === "table-overflow");

  it("47-row table + Midnight → exactly 1 warn with lever split", () => {
    const issues = overflows(glossary(47));
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(0);
    expect(issues[0].title).toBe("用語集");
    expect(issues[0].level).toBe("warn");
    expect(issues[0].level).toBe(REVIEW_RULES.find((r) => r.id === "table-overflow")!.level);
    expect(issues[0].levers).toEqual(["split"]);
    expect(issues[0].message).toContain("47 行");
    expect(issues[0].message).toMatch(/推定 \d+ 行まで/);
  });

  it("few rows whose cells WRAP to many lines also overflow (the estimate counts wrapped lines)", () => {
    const long = () => "長い説明文".repeat(60); // ~600 display columns per cell → many wrapped lines
    expect(overflows(glossary(8, long))).toHaveLength(1);
  });

  // ── 負側：収まる表は 0 件・出力不変 ──
  it("5-row table → 0 (and the whole deck stays issue-free)", () => {
    expect(diagnoseDeck(parseMd(glossary(5)), catalog, tpl.layouts)).toEqual([]);
  });

  it("12-row table (the issue's 'almost fits' slide) → 0", () => {
    expect(overflows(glossary(12))).toEqual([]);
  });

  it("2-arg diagnoseDeck (no template) is unchanged — the check needs the placed box", () => {
    expect(diagnoseDeck(parseMd(glossary(47))).filter((i) => i.id === "table-overflow")).toEqual([]);
  });
});

describe("estimateTableRowHeightsIn — reuses table-layout's widths + table-ooxml's metrics (R8)", () => {
  const lineIn = (TABLE_CELL.fontPt * 1.2) / 72;
  const padIn = (2 * TABLE_CELL.marTBEmu) / 914400;

  it("a short single-line row is one line + the top/bottom cell margins", () => {
    const [h] = estimateTableRowHeightsIn([["a", "b"]], 11.7);
    expect(h).toBeCloseTo(lineIn + padIn, 6);
  });

  it("a cell 3× its column's line capacity wraps to 3 lines", () => {
    // With a ≥12-col cell beside a 1-col cell, table-layout clamps the widths to 50% / 8% of the box,
    // so the long column's width is the SAME for every length used below (asserted, not assumed).
    const boxW = 4;
    const [colW] = computeColumnWidthsEmu([["x".repeat(12), "y"]], boxW); // the widths table-ooxml's gridCol gets
    const capacity = Math.floor((((colW - 2 * TABLE_CELL.marLREmu) / 914400) * 72) / (TABLE_CELL.fontPt / 2));
    expect(capacity).toBeGreaterThanOrEqual(12);
    for (const len of [capacity, capacity * 3]) expect(computeColumnWidthsEmu([["x".repeat(len), "y"]], boxW)[0]).toBe(colW);
    const lines = (len: number) => Math.round((estimateTableRowHeightsIn([["x".repeat(len), "y"]], boxW)[0] - padIn) / lineIn);
    expect(lines(capacity)).toBe(1);
    expect(lines(capacity + 1)).toBe(2);
    expect(lines(capacity * 3)).toBe(3);
  });

  it("table-ooxml writes exactly TABLE_CELL's font size and margins (one definition)", () => {
    const xml = tableGraphicFrameXml([["h1", "h2"], ["a", ""]], true, { x: 0, y: 0, w: 4, h: 1 }, 2);
    expect(xml).toContain(`sz="${TABLE_CELL.fontPt * 100}"`);
    expect(xml).toContain(`marL="${TABLE_CELL.marLREmu}" marR="${TABLE_CELL.marLREmu}" marT="${TABLE_CELL.marTBEmu}" marB="${TABLE_CELL.marTBEmu}"`);
    expect(xml).not.toMatch(/sz="(?!1100")\d+"/);
  });

  it("table-ooxml output is byte-identical to before the metrics were named (pre-#436 sha256)", () => {
    const rows = [["項目", "値", "備考"], ["応答時間", "120", "**重要**"], ["", "3.5%", "[仕様](https://example.com)"], ["長い説明テキストを含むセル", "1,200", ""]];
    const xml = tableGraphicFrameXml(rows, true, { x: 0.8, y: 1.45, w: 11.7, h: 5.4 }, 7, () => "rId5");
    expect(createHash("sha256").update(xml).digest("hex")).toBe("f1495301bf8024718c4fdfa4774bd27cfb9432b2b671d5cd7e231c881035cc2a");
  });
});
