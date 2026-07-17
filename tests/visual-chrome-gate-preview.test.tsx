/**
 * visual-chrome-gate-preview.test.tsx — #124 の WYSIWYG 側。プレビューと PPTX は同じ resolver
 * （bodyPlaceholders / nthBody）を共有するので、chrome ゲートで body 序数が空になった時の挙動も
 * 一致していなければならない。
 *
 * 罠: プレビューの図はプレースホルダ走査の中で描かれる（描画先 ph に紐付く）ため、body 序数が空だと
 * **solo 図（全画面）がプレビューから消える**——一方 export は全画面で描き続ける（buildSlideXml は
 * solo に ph を要さない）。ゲート導入でこの経路（0 body レイアウト）が現実に到達可能になったので、
 * ここで固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard } from "../src/components/SlidePreview";
import { loadTemplate, findLayout, type TemplateData } from "../src/engine/template-loader";
import { bodyPlaceholders } from "../src/engine/visual-placement";
import type { SlideIR } from "../src/engine/slide-schema";

const KOUBUN = resolve(__dirname, "../public/templates/slide/配布資料_公文書高密度_TemplateOnly.pptx");
const DIAG = "type: flowchart\ndirection: TB\nnodes:\n  - id: a\n    label: 入力\n  - id: b\n    label: 出力\nedges:\n  - from: a\n    to: b\n";

describe("#124 プレビュー: chrome ゲート後も export と一致する", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(KOUBUN));
  });

  const render = (slide: SlideIR): string => {
    const layout = findLayout(tpl, slide.layout);
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

  it("05_比較表（実 body ゼロ）でも solo 図は描かれる＝ export の全画面描画と一致", () => {
    const layout = tpl.layouts.find((l) => l.name === "05_比較表")!;
    expect(bodyPlaceholders(layout.placeholders)).toEqual([]); // 前提: ゲートで body 序数が空
    const slide = { layout: "05_比較表", placeholders: [], diagram: { yaml: DIAG, placeholderIdx: "1" } } as unknown as SlideIR;
    const html = render(slide);
    expect(html).toContain("入力"); // 図が消えない（描画先 ph が無くても solo は全画面）
    expect(html).toContain("出力");
  });

  it("08_目次: 区画指定(序数2)の図は行き場が無ければ描かれない＝ export と一致（本文を覆わない）", () => {
    const slide = {
      layout: "08_目次",
      placeholders: [{ idx: "1", paragraphs: [{ segments: [{ text: "第1章" }] }] }],
      diagram: { yaml: DIAG, placeholderIdx: "2" },
    } as unknown as SlideIR;
    const html = render(slide);
    expect(html).toContain("第1章"); // 本文は残る
    expect(html).not.toContain("入力"); // 図は全画面へ勝手に広がらない
  });
});
