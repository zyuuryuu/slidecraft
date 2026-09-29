/**
 * table-inline.test.ts — #395: 表セル内のインライン書式（**強調** 等）が記法ごと印字される問題の受け入れ基準。
 * Written before the fix (R3).
 *
 * セルは TableBlock.rows に string のまま保持し、描画時に #393 の parseInline（唯一のインライン
 * パーサ — R8）を通す。したがって round-trip は rows 文字列そのままで自明に安定。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { tableGraphicFrameXml } from "../src/engine/table-ooxml";
import { computeColumnWidthsEmu, computeNumericColumns } from "../src/engine/table-layout";
import { generatePptx } from "../src/engine/placeholder-filler";
import { loadTemplate, findLayout, type TemplateData } from "../src/engine/template-loader";
import { SlideCard } from "../src/components/SlidePreview";
import type { SlideIR } from "../src/engine/slide-schema";

const TEMPLATE_PATH = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

/** 行位置メタ（エディタ用 sourceLineStart/End）を除いた内容のみ — serializer は末尾改行を足すため行番号はずれ得る。 */
const content = (slides: SlideIR[]) =>
  slides.map((s) => {
    const rest = { ...s };
    delete rest.sourceLineStart;
    delete rest.sourceLineEnd;
    return rest;
  });
const BOX = { x: 0.5, y: 1.5, w: 12, h: 4 };

const cellTexts = (xml: string) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);

describe("tableGraphicFrameXml — セル内インライン書式 (#395)", () => {
  it("受け入れ基準: `| **重要** | 通常 |` → 該当セルの run に b=\"1\"、** は印字されない", () => {
    const xml = tableGraphicFrameXml([["項目", "区分"], ["**重要**", "通常"]], true, BOX, 10);
    expect(xml).not.toContain("**");
    expect(xml).toContain(
      `<a:r><a:rPr lang="en-US" sz="1100" b="1"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></a:rPr><a:t>重要</a:t></a:r>`,
    );
    // 「通常」セルは太字にならない
    expect(xml).toContain(
      `<a:r><a:rPr lang="en-US" sz="1100"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></a:rPr><a:t>通常</a:t></a:r>`,
    );
  });

  it("1 セル内の混在は複数 run になる（斜体・取消線・コード）", () => {
    const xml = tableGraphicFrameXml([["A"], ["前 *斜* ~~消~~ `c`"]], true, BOX, 10);
    expect(cellTexts(xml)).toEqual(["A", "前 ", "斜", " ", "消", " ", "c"]);
    expect(xml).toContain(`i="1"`);
    expect(xml).toContain(`strike="sngStrike"`);
  });

  it("ヘッダ行は従来どおり全 run が太字（セル内記法があっても b=\"1\" は重複しない）", () => {
    const xml = tableGraphicFrameXml([["**見出し**", "*注*"], ["x", "y"]], true, BOX, 10);
    expect(xml).not.toMatch(/b="1"[^>]*b="1"/);
    const headerRuns = [...xml.matchAll(/<a:rPr lang="en-US" sz="1100"([^>]*)>/g)].slice(0, 2).map((m) => m[1]);
    for (const attrs of headerRuns) expect(attrs).toContain(`b="1"`);
  });

  it("対にならない * はセルでもリテラルで残る（脚注記号 *注 等）", () => {
    const xml = tableGraphicFrameXml([["A"], ["*注 概算"]], true, BOX, 10);
    expect(cellTexts(xml)).toEqual(["A", "*注 概算"]);
  });

  it("セル内リンクはリゾルバの rId で hlinkClick を持つ（solidFill の後ろ＝スキーマ順）", () => {
    const xml = tableGraphicFrameXml([["A"], ["[仕様](https://e.x)"]], true, BOX, 10, () => "rId5");
    expect(xml).toContain(
      `<a:rPr lang="en-US" sz="1100"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill><a:hlinkClick r:id="rId5"/></a:rPr><a:t>仕様</a:t>`,
    );
  });

  it("列幅・数値列判定は記法を除いた表示テキストで測る", () => {
    expect(computeNumericColumns([["h"], ["**12**"], ["3"]], true)).toEqual([true]);
    expect(computeColumnWidthsEmu([["**aaaa**", "bbbb"]], 10)).toEqual(computeColumnWidthsEmu([["aaaa", "bbbb"]], 10));
  });
});

describe("表セル書式 — パース/round-trip/PPTX (#395)", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(TEMPLATE_PATH));
  });

  const MD = `# 比較

| 観点 | 案A | 案B |
|------|-----|-----|
| 結論 | **採用** | ~~不採用~~ |
| 資料 | [仕様](https://example.com/a) | \`cfg.yaml\` |
`;

  it("rows は記法込みの文字列のまま保持され、serializeMd で同じ表に戻る", () => {
    const deck = parseMd(MD);
    expect(deck.slides[0].table!.rows[1]).toEqual(["結論", "**採用**", "~~不採用~~"]);
    expect(content(parseMd(serializeMd(deck)).slides)).toEqual(content(deck.slides));
  });

  it("PPTX: セルのリンクが slide rels の External hyperlink に配線される", async () => {
    const zip = await JSZip.loadAsync(await generatePptx(parseMd(MD), tpl));
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    const tbl = slide.slice(slide.indexOf("<a:tbl>"));
    expect(cellTexts(tbl).join("|")).not.toMatch(/\*\*|~~|`|\]\(/);
    const rid = tbl.match(/<a:hlinkClick r:id="(rId\d+)"\/>/)?.[1];
    expect(rid).toBeDefined();
    expect(rels).toMatch(new RegExp(`<Relationship Id="${rid}"[^>]*Target="https://example\\.com/a"[^>]*TargetMode="External"/>`));
  });

  it("プレビュー: セル内の太字・取消線が描画され、記号は表示されない", () => {
    const layoutName = "Table.1Table.Single+1Source";
    const layout = findLayout(tpl, layoutName);
    const slide = {
      layout: layoutName,
      placeholders: [],
      table: { rows: [["A", "B"], ["**採用**", "~~不採用~~"]], header: true, placeholderIdx: "1" },
    } as unknown as SlideIR;
    const html = renderToStaticMarkup(
      createElement(SlideCard, {
        slide, slideIndex: 0, totalSlides: 1, layout,
        masterBgColor: tpl.masterBgColor, masterDecorations: tpl.masterDecorations,
        masterStaticTexts: tpl.masterStaticTexts, scale: 96, exportMode: true,
      }),
    );
    const tbl = html.slice(html.indexOf("<table"));
    expect(tbl).not.toMatch(/\*\*|~~/);
    expect(tbl).toMatch(/<span style="font-weight:bold">採用<\/span>/);
    expect(tbl).toMatch(/<span style="text-decoration:line-through">不採用<\/span>/);
  });
});
