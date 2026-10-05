/**
 * table-preview-cell-metrics.test.tsx — #443: a table row's height differed between the preview
 * (td `padding: 1px 6px`, px literals) and the PPTX export (TABLE_CELL = 0.05in top/bottom margins),
 * so a long table could fit on screen yet overflow in PowerPoint. The preview's cell metrics must be
 * DERIVED from table-layout's TABLE_CELL — the same values table-ooxml writes and
 * estimateTableRowHeightsIn reads — and this agreement test (R8) pins the two paths to each other.
 * PPTX-side output stays byte-identical (the export's tcPr margins are asserted unchanged below).
 * Written before the fix (R3).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard } from "../src/components/SlidePreview";
import { loadTemplate, findLayout, type TemplateData } from "../src/engine/template-loader";
import { estimateTableRowHeightsIn, TABLE_CELL } from "../src/engine/table-layout";
import { tableGraphicFrameXml } from "../src/engine/table-ooxml";
import type { SlideIR } from "../src/engine/slide-schema";

const TPL_PATH = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const LAYOUT_NAME = "Table.1Table.Single+1Source"; // body box w=12.3in (from the fixture template)
const BOX_W = 12.3;
const SCALE = 96; // px per inch, the preview's scale unit (fontSize = pt × scale/72)

// Short cells: every cell fits one estimated line, so the per-row estimate is the pure
// single-line height (line + top/bottom margins) — the quantity the issue measured (#443).
const ROWS = [
  ["項目", "値"],
  ["速度", "0.8秒"],
];

describe("#443 preview td metrics derive from TABLE_CELL (agreement, R8)", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(TPL_PATH));
  });

  const render = (): string => {
    const layout = findLayout(tpl, LAYOUT_NAME);
    const slide = {
      layout: LAYOUT_NAME,
      placeholders: [],
      table: { rows: ROWS, header: true, placeholderIdx: "1" },
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
        scale={SCALE}
        exportMode
      />,
    );
  };

  function tdStyle(html: string): string {
    const m = html.match(/<td style="([^"]*)"/);
    expect(m, "a <td> with inline style").toBeTruthy();
    return m![1];
  }

  function tableStyle(html: string): string {
    const m = html.match(/<table style="([^"]*)"/);
    expect(m, "a <table> with inline style").toBeTruthy();
    return m![1];
  }

  it("preview single-row height (px→in) matches estimateTableRowHeightsIn within ±5%", () => {
    const html = render();
    const td = tdStyle(html);
    const tbl = tableStyle(html);

    const pad = td.match(/padding:([\d.]+)px ([\d.]+)px/);
    expect(pad, "td padding as `<tb>px <lr>px`").toBeTruthy();
    const padTbPx = Number(pad![1]);

    const fs = tbl.match(/font-size:([\d.]+)px/);
    expect(fs, "table font-size in px").toBeTruthy();
    const lh = tbl.match(/line-height:([\d.]+)/);
    expect(lh, "an explicit line-height (browser default must not decide the row height)").toBeTruthy();

    // One-line row height as CSS computes it: text line + top/bottom padding.
    const previewRowIn = (Number(fs![1]) * Number(lh![1]) + 2 * padTbPx) / SCALE;
    const exportRowIn = estimateTableRowHeightsIn(ROWS, BOX_W)[1];
    expect(Math.abs(previewRowIn - exportRowIn) / exportRowIn).toBeLessThanOrEqual(0.05);
  });

  it("td left/right padding matches TABLE_CELL.marLREmu (px→EMU)", () => {
    const pad = tdStyle(render()).match(/padding:([\d.]+)px ([\d.]+)px/);
    const padLrEmu = (Number(pad![2]) / SCALE) * 914400;
    expect(padLrEmu).toBeCloseTo(TABLE_CELL.marLREmu, 0);
  });

  it("td top/bottom padding matches TABLE_CELL.marTBEmu (px→EMU)", () => {
    const pad = tdStyle(render()).match(/padding:([\d.]+)px ([\d.]+)px/);
    const padTbEmu = (Number(pad![1]) / SCALE) * 914400;
    expect(padTbEmu).toBeCloseTo(TABLE_CELL.marTBEmu, 0);
  });

  it("preview font size still comes from TABLE_CELL.fontPt (pt × scale/72)", () => {
    const fs = tableStyle(render()).match(/font-size:([\d.]+)px/);
    expect(Number(fs![1])).toBeCloseTo(TABLE_CELL.fontPt * (SCALE / 72), 5);
  });

  // Negative side: the fix is preview-only. The export's cell margins are TABLE_CELL verbatim,
  // unchanged by #443 — PPTX output stays byte-identical.
  it("PPTX export unchanged: tcPr still writes marT/marB=45720, marL/marR=91440", () => {
    const xml = tableGraphicFrameXml(ROWS, true, { x: 0.5, y: 1.5, w: BOX_W, h: 4 }, 10);
    expect(xml).toContain('marL="91440" marR="91440" marT="45720" marB="45720"');
    expect(TABLE_CELL).toEqual({ fontPt: 11, marLREmu: 91440, marTBEmu: 45720 });
  });
});
