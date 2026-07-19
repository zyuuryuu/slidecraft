/**
 * table-preview.test.tsx — #139 (preview cells wrap instead of nowrap-truncating) +
 * #138 preview-side parity (colgroup widths match the shared table-layout computation,
 * numeric columns right-aligned). Written before the fix (R3).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard } from "../src/components/SlidePreview";
import { loadTemplate, findLayout, type TemplateData } from "../src/engine/template-loader";
import { computeColumnWidthsEmu, computeNumericColumns } from "../src/engine/table-layout";
import type { SlideIR } from "../src/engine/slide-schema";

const TPL_PATH = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const LAYOUT_NAME = "Table.1Table.Single+1Source"; // body box w=12.3in (from the fixture template)

const LONG_CELL =
  "アクセス制御の見直しとログ監査の強化を継続的に実施中で長文セルの折り返し確認用テキストです";

const RISK_TABLE = [
  ["#", "リスク", "影響", "発生確率", "対応状況"],
  ["1", "データ漏洩", "大", "20%", LONG_CELL],
];

describe("#139 / #138 SlidePreview table rendering", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(TPL_PATH));
  });

  const render = (): string => {
    const layout = findLayout(tpl, LAYOUT_NAME);
    const slide = {
      layout: LAYOUT_NAME,
      placeholders: [],
      table: { rows: RISK_TABLE, header: true, placeholderIdx: "1" },
    } as unknown as SlideIR;
    return renderToStaticMarkup(
      <SlideCard
        slide={slide}
        slideIndex={0}
        totalSlides={1}
        layout={layout}
        masterBgColor={tpl.masterBgColor}
        masterDecorations={tpl.masterDecorations}
        masterStaticTexts={tpl.masterStaticTexts}
        scale={96}
        exportMode
      />,
    );
  };

  it("#139: cell style has no nowrap — long text is free to wrap, not truncated", () => {
    const html = render();
    expect(html).toContain(LONG_CELL); // full text present (never truncated in the DOM)
    expect(html).not.toMatch(/white-space:\s*nowrap/);
  });

  it("#138: <col> widths are non-uniform and match computeColumnWidthsEmu exactly", () => {
    const html = render();
    const widthsEmu = computeColumnWidthsEmu(RISK_TABLE, 12.3);
    const totalEmu = widthsEmu.reduce((a, b) => a + b, 0);
    const expectedPct = widthsEmu.map((w) => (w / totalEmu) * 100);

    const colMatches = [...html.matchAll(/<col style="width:([\d.]+)%"/g)];
    expect(colMatches).toHaveLength(RISK_TABLE[0].length);
    colMatches.forEach((m, i) => {
      expect(Number(m[1])).toBeCloseTo(expectedPct[i], 5);
    });
    // not an equal 5-way split (20% each)
    expect(expectedPct.some((p) => Math.abs(p - 20) > 2)).toBe(true);
  });

  it("#138: numeric columns ('#', '発生確率') are right-aligned in the preview", () => {
    const html = render();
    const numeric = computeNumericColumns(RISK_TABLE, true);
    expect(numeric).toEqual([true, false, false, true, false]);
    // The "1" cell (col 0, numeric) is right-aligned; the risk-name cell (col 1) is not.
    expect(html).toMatch(/<td[^>]*text-align:\s*right[^"]*"[^>]*>1</);
    expect(html).not.toMatch(/<td[^>]*text-align:\s*right[^"]*"[^>]*>データ漏洩</);
  });
});
