/**
 * table.test.ts — Native table support: GFM Markdown table → TableBlock →
 * native OOXML table (<a:tbl>), with preview parity + Markdown round-trip.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { parseMarkdownTable, tableToMarkdown, isTableRow } from "../src/engine/md-table";
import { tableGraphicFrameXml } from "../src/engine/table-ooxml";
import { loadTemplate } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";

const MD = `# プラン比較
> 料金プラン

| プラン | 月額 | ユーザー数 |
|--------|------|-----------|
| Free | ¥0 | 1 |
| Pro | ¥1,200 | 10 |
| Enterprise | 要相談 | 無制限 |
`;

describe("md-table helpers", () => {
  it("parses a GFM table into rectangular rows (header first)", () => {
    const lines = MD.split("\n");
    const parsed = parseMarkdownTable(lines.slice(lines.findIndex(isTableRow)))!;
    expect(parsed.rows[0]).toEqual(["プラン", "月額", "ユーザー数"]);
    expect(parsed.rows).toHaveLength(4); // header + 3
    expect(parsed.rows[3]).toEqual(["Enterprise", "要相談", "無制限"]);
  });
  it("round-trips rows <-> markdown, escaping pipes", () => {
    const rows = [["a|b", "c"], ["1", "2"]];
    expect(parseMarkdownTable(tableToMarkdown(rows).split("\n"))!.rows).toEqual(rows);
  });
});

describe("table in a slide", () => {
  it("parseMd produces a native table block (not bullet text)", () => {
    const slide = parseMd(MD).slides[0];
    expect(slide.table?.rows).toHaveLength(4);
    expect(slide.table?.header).toBe(true);
    expect(slide.placeholders.find((p) => p.idx === "1")).toBeUndefined(); // body NOT bullets
  });
  it("round-trips through serializeMd", () => {
    const deck = parseMd(MD);
    expect(parseMd(serializeMd(deck)).slides[0].table?.rows).toEqual(deck.slides[0].table?.rows);
  });
});

describe("table OOXML", () => {
  it("generates a native <a:tbl> graphicFrame with cell text + grid", () => {
    const xml = tableGraphicFrameXml([["H1", "H2"], ["a", "b"]], true, { x: 1, y: 1, w: 8, h: 2 }, 5);
    expect(xml).toContain("<a:tbl>");
    expect(xml).toContain('uri="http://schemas.openxmlformats.org/drawingml/2006/table"');
    expect(xml).toContain("<a:t>H1</a:t>");
    expect((xml.match(/<a:tr/g) ?? []).length).toBe(2);
    expect((xml.match(/<a:gridCol/g) ?? []).length).toBe(2);
  });
  it("escapes XML special chars in cells", () => {
    expect(tableGraphicFrameXml([["a<b>&"]], true, { x: 0, y: 0, w: 1, h: 1 }, 2)).toContain("a&lt;b&gt;&amp;");
  });
});

describe("table in a real PPTX deck", () => {
  it("exports as a native <a:tbl> (no image), valid zip", async () => {
    const tpl = await loadTemplate(readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")));
    const zip = await JSZip.loadAsync(await generatePptx(parseMd(MD), tpl));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toContain("<a:tbl>");
    expect(xml).toContain("Enterprise");
    expect(xml).toContain("ユーザー数");
    expect(xml.includes("<a:blip ")).toBe(false); // native table, not an image
  });
});
