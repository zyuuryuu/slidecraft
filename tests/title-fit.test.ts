/**
 * title-fit.test.ts — Issue #437 案b: 長いタイトルを R7 の事前計算でタイトル枠に収まるまで段階的に
 * 縮小し（fitTitle）、その結果を PPTX（タイトル run に sz を焼く）・プレビュー（SlideCard の
 * font-size）・診断（下限でも収まらないときだけ warn title-overflow）の 3 経路が同じ値で読む（R8）。
 *
 * 不変条件: 収まるタイトルは何も変わらない（sz を焼かない・プレビューのフォントも元のまま）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SlideCard } from "../src/components/SlidePreview";
import { loadTemplate, findLayout, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { generatePptx } from "../src/engine/placeholder-filler";
import { slideBindingPlan } from "../src/engine/group-binding";
import { fitTitle, slideRoleContent, TITLE_MIN_SCALE } from "../src/engine/title-fit";
import { estTextWidth } from "../src/engine/draw-target";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

// Issue #437 repro（性能試験デッキ slide 5）。Midnight Content のタイトル枠 10.0×0.52in・28pt で溢れる。
const LONG_TITLE = "Citrix NetScaler ―― 9 月に 2 度の KEV 登録、Web シェルで常駐";
// 下限（28pt × TITLE_MIN_SCALE）まで縮めても 1 行に収まらない長さ。
const HUGE_TITLE = "あ".repeat(60);
const SHORT_TITLE = "短いタイトル";

// Midnight Content.1Body.Single のタイトル枠（実測: tests の probe / template-loader の PlaceholderStyle）。
const CONTENT_TITLE_BOX = { w: 10.0, h: 0.52, fontSize: 28 };
const para = (text: string) => [{ segments: [{ text }] }];

/** 表紙 + 対象スライド + 末尾スライドの 3 枚デッキ（title-overflow.test.ts と同形）。 */
const deckMd = (title: string) => `# 表紙\n\n## サブ\n\n---\n\n# ${title}\n\n- 速度: 0.8秒\n- 重量: 1.2kg\n\n---\n\n# 短い結び\n\n- a`;

describe("fitTitle — 純関数（#437 案b）", () => {
  it("短いタイトル → 元サイズのまま・収まる", () => {
    expect(fitTitle(para(SHORT_TITLE), CONTENT_TITLE_BOX)).toMatchObject({ basePt: 28, fontPt: 28, fits: true });
  });

  it("長タイトル → 28pt 未満・下限以上に縮小して収まる（収まる最大の整数 pt）", () => {
    const fit = fitTitle(para(LONG_TITLE), CONTENT_TITLE_BOX);
    expect(fit.fits).toBe(true);
    expect(fit.fontPt).toBeLessThan(28);
    expect(fit.fontPt).toBeGreaterThanOrEqual(28 * TITLE_MIN_SCALE);
    const usableW = (CONTENT_TITLE_BOX.w - 0.2) * 72;
    expect(estTextWidth(LONG_TITLE, fit.fontPt)).toBeLessThanOrEqual(usableW);
    expect(estTextWidth(LONG_TITLE, fit.fontPt + 1)).toBeGreaterThan(usableW); // 1pt 大きいと溢れる＝最大
  });

  it("下限でも収まらない → fits=false・下限以上の最小ステップで止まる", () => {
    const fit = fitTitle(para(HUGE_TITLE), CONTENT_TITLE_BOX);
    expect(fit.fits).toBe(false);
    expect(fit.fontPt).toBe(20); // 28, 27, … 20 ≥ 19.6 > 19
    expect(fit.minPt).toBeCloseTo(28 * TITLE_MIN_SCALE);
  });

  it("空タイトル・幅を見積もれない枠 → 何もしない", () => {
    expect(fitTitle(para(""), CONTENT_TITLE_BOX)).toMatchObject({ fontPt: 28, fits: true });
    expect(fitTitle(para(HUGE_TITLE), { w: 0.1, h: 0.5, fontSize: 28 })).toMatchObject({ fontPt: 28, fits: true });
  });
});

describe("3 経路が fitTitle を同じ値で読む（R8）— Midnight", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(MIDNIGHT));
    catalog = buildCatalog(tpl);
  });

  /** 対象スライド（index 1）のタイトルが束縛される枠と、その fitTitle。 */
  function expected(title: string) {
    const deck = parseMd(deckMd(title));
    const slide = deck.slides[1];
    const layout = findLayout(tpl, autoSelectLayout(slide, 1, deck.slides.length, catalog))!;
    // タイトル内容が束縛される枠＝export / preview と同じ束縛計画（slideBindingPlan）から引く。
    const titleC = slideRoleContent(slide, "title")!;
    const a = slideBindingPlan(slide, layout).assignments.find((x) => x.content.content === titleC)!;
    const tph = layout.placeholders.find((p) => p.idx === a.placeholder.idx)!;
    expect(tph.style).toMatchObject({ w: CONTENT_TITLE_BOX.w, fontSize: 28 }); // 実測した Content 系タイトル枠
    return { deck, slide, layout, fit: fitTitle(titleC.paragraphs, tph.style) };
  }

  async function slide2Xml(title: string): Promise<string> {
    const buf = await generatePptx(parseMd(deckMd(title)), tpl);
    const zip = await JSZip.loadAsync(buf);
    return zip.file("ppt/slides/slide2.xml")!.async("string");
  }

  function previewHtml(title: string): string {
    const { deck, slide, layout } = expected(title);
    return renderToStaticMarkup(
      createElement(SlideCard, {
        slide, slideIndex: 1, totalSlides: deck.slides.length, layout,
        masterBgColor: tpl.masterBgColor, masterDecorations: tpl.masterDecorations, masterStaticTexts: tpl.masterStaticTexts,
        scale: 72, exportMode: true,
      }),
    );
  }

  it("PPTX: 長タイトルの run に fitTitle の sz が焼かれる", async () => {
    const { fit } = expected(LONG_TITLE);
    expect(fit.fontPt).toBeLessThan(28);
    const xml = await slide2Xml(LONG_TITLE);
    expect(xml).toContain(`<a:rPr sz="${fit.fontPt * 100}"/><a:t>Citrix NetScaler`);
  });

  it("PPTX: 短いタイトルには sz を焼かない（スライド XML に sz 属性ゼロ）", async () => {
    const xml = await slide2Xml(SHORT_TITLE);
    expect(xml).toContain(SHORT_TITLE);
    expect(xml).not.toMatch(/<a:rPr[^>]* sz="/);
  });

  it("プレビュー: タイトル枠の font-size が fitTitle の pt（scale 72 → px = pt）", () => {
    const { fit } = expected(LONG_TITLE);
    const html = previewHtml(LONG_TITLE);
    const at = html.indexOf("Citrix NetScaler");
    const box = html.lastIndexOf("<div", html.lastIndexOf("font-size:", at));
    expect(html.slice(box, at)).toContain(`font-size:${fit.fontPt}px`);
  });

  it("プレビュー: 短いタイトルは元の 28pt のまま", () => {
    const html = previewHtml(SHORT_TITLE);
    const at = html.indexOf(SHORT_TITLE);
    const box = html.lastIndexOf("<div", html.lastIndexOf("font-size:", at));
    expect(html.slice(box, at)).toContain("font-size:28px");
  });

  it("診断: 縮小で収まる長タイトル → title-overflow 0 件／下限でも収まらない → 1 件（fits と一致）", () => {
    const issues = (t: string) => diagnoseDeck(parseMd(deckMd(t)), catalog, tpl.layouts).filter((i) => i.id === "title-overflow");
    expect(expected(LONG_TITLE).fit.fits).toBe(true);
    expect(issues(LONG_TITLE)).toEqual([]);
    expect(expected(HUGE_TITLE).fit.fits).toBe(false);
    const huge = issues(HUGE_TITLE);
    expect(huge).toHaveLength(1);
    expect(huge[0]).toMatchObject({ slideIndex: 1, level: "warn", levers: ["condense"] });
    expect(huge[0].message).toContain("20pt");
  });
});
