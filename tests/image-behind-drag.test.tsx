/**
 * image-behind-drag.test.tsx — Issue #122: 最背面（`behind=1`）画像もプレビュー上で直接ドラッグ／リサイズできる。
 *
 * 以前は behind 画像の枠線＋角ハンドルが placeholder（タイトル・本文）の**下**に描かれて掴めないため、
 * 編集を無効化しフォーム数値（X/Y/W/H）だけにしていた。今は:
 *   - 画像そのものは従来どおり最背面スロット（placeholder より前＝下）に描く（z 順・PPTX/HTML は不変）
 *   - 編集 chrome（枠線＋角ハンドル）だけを最前面の overlay（`data-image-chrome`）として描く
 *   - ドラッグは前面画像と**同じ経路**（image-gesture → dragImageRect → onImageRectChange → rect）を通る
 *     ＝第 2 の座標計算を作らない（R8）。フォームとプレビューは同じ imageEditGeometry を使う（一致テスト）
 *   - 前面画像の編集 markup は変更前（main）の出力と byte-identical（fixtures/preview/*.html）
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { loadTemplate, findLayout, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { imagePlaceholder, imageRect, imageAspectRatio, imageEditGeometry } from "../src/engine/visual-placement";
import { startImageGesture, moveImageGesture, endImageGesture } from "../src/components/image-gesture";
import { SlideCard, SLIDE_W, SLIDE_H } from "../src/components/SlidePreview";
import type { SlideIR } from "../src/engine/slide-schema";

const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");
const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const BEHIND_MD = `# 背景つきタイトル\n\n- 本文の箇条書き\n\n![](${IMG}){x=1,y=1,w=6,h=4,fit=cover,behind=1}`;

let tpl: TemplateData;
beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(REPORT));
});

function card(md: string, opts: { active?: boolean; editable?: boolean; exportMode?: boolean } = {}) {
  const deck = parseMd(md);
  const slide = deck.slides[0];
  const layout = findLayout(tpl, autoSelectLayout(slide, 0, deck.slides.length, buildCatalog(tpl)))!;
  const html = renderToStaticMarkup(
    <SlideCard
      slide={slide} slideIndex={0} totalSlides={1} layout={layout} masterBgColor={tpl.masterBgColor} scale={96}
      isActive={opts.active ?? true}
      exportMode={opts.exportMode}
      onImageRectChange={opts.editable === false ? undefined : () => {}}
    />,
  );
  return { slide, layout, html };
}

describe("#122 前面画像の編集 markup は不変（変更前の出力と byte-identical）", () => {
  it.each([
    ["front-image-editable", `# 画像\n\n![図](${IMG}){x=1,y=1.5,w=4,h=3,ar=1.3333}`],
    ["front-image-default-editable", `# 画像\n\n![](${IMG})`],
  ])("%s", (name, md) => {
    const expected = readFileSync(resolve(__dirname, `fixtures/preview/${name}.html`), "utf8").trimEnd();
    expect(card(md).html).toBe(expected);
  });
});

describe("#122 最背面画像: 編集 chrome（枠線＋角ハンドル）は最前面 overlay", () => {
  it("編集可能（active ＋ onImageRectChange）なら 4 角ハンドルと chrome root を描く", () => {
    const { html } = card(BEHIND_MD);
    expect(html.match(/data-image-handle="(nw|ne|sw|se)"/g)).toEqual([
      'data-image-handle="nw"', 'data-image-handle="ne"', 'data-image-handle="sw"', 'data-image-handle="se"',
    ]);
    expect(html.match(/data-image-chrome="true"/g)).toHaveLength(1);
  });

  it("z 順: 画像は本文より前（＝下）、chrome は本文より後（＝上）に描かれる", () => {
    const { html } = card(BEHIND_MD);
    const imgAt = html.indexOf(`<img src="${IMG}"`);
    const textAt = html.indexOf("本文の箇条書き");
    const chromeAt = html.indexOf('data-image-chrome="true"');
    expect(imgAt).toBeGreaterThan(-1);
    expect(textAt).toBeGreaterThan(imgAt); // the picture stays backmost
    expect(chromeAt).toBeGreaterThan(textAt); // the handles sit IN FRONT of the content
    // the handles live inside the chrome, not inside the (covered) picture wrapper
    expect(html.indexOf('data-image-handle="nw"')).toBeGreaterThan(chromeAt);
  });

  it("chrome の枠は画像の rect と同じ位置（同じ % 座標）に置かれる", () => {
    const { html } = card(BEHIND_MD);
    const pct = (v: number, of: number) => `${(v / of) * 100}%`;
    const chrome = html.slice(html.indexOf('data-image-chrome="true"'));
    const style = chrome.match(/style="([^"]*)"/)![1];
    expect(style).toContain(`left:${pct(1, SLIDE_W)}`);
    expect(style).toContain(`top:${pct(1, SLIDE_H)}`);
    expect(style).toContain(`width:${pct(6, SLIDE_W)}`);
    expect(style).toContain(`height:${pct(4, SLIDE_H)}`);
    // the chrome box itself lets clicks through (only the frame strips + handles are grabbable)
    expect(style).toContain("pointer-events:none");
  });

  it.each([
    ["非 active", { active: false }],
    ["onImageRectChange なし", { editable: false }],
  ])("編集不可（%s）なら chrome もハンドルも出さない", (_label, opts) => {
    const { html } = card(BEHIND_MD, opts);
    expect(html).not.toContain("data-image-handle");
    expect(html).not.toContain("data-image-chrome");
    expect(html).toContain(`<img src="${IMG}"`); // the picture itself still renders
  });

  it("exportMode（HTML 出力）では chrome を出さない", () => {
    const { html } = card(BEHIND_MD, { exportMode: true, editable: false });
    expect(html).not.toContain("data-image-handle");
    expect(html).not.toContain("data-image-chrome");
  });
});

describe("#122 ドラッグ → Markdown の x/y 書き戻し（前面と同じ経路）", () => {
  /** useDeckController.handleImageRectChange と同じ合成: slide.image.rect を差し替える。 */
  const commit = (slide: SlideIR, rect: NonNullable<SlideIR["image"]>["rect"]): SlideIR => ({ ...slide, image: { ...slide.image!, rect } });

  it("behind 画像を (+96px, +48px) @scale 96 で移動 → x/y が +1in/+0.5in、behind=1 は保持", () => {
    const { slide, layout } = card(BEHIND_MD);
    const { box, aspect } = imageEditGeometry(slide.image!, layout.placeholders);
    const g = startImageGesture("move", box!, 100, 100);
    expect(moveImageGesture(g, 196, 148, 96, aspect, SLIDE_W, SLIDE_H)).toEqual({ x: 2, y: 1.5, w: 6, h: 4 });
    const rect = endImageGesture(g);
    expect(rect).toEqual({ x: 2, y: 1.5, w: 6, h: 4 });
    const md = serializeMd({ slides: [commit(slide, rect!)] });
    expect(md).toContain("{x=2,y=1.5,w=6,h=4,fit=cover,behind=1}");
    const back = parseMd(md).slides[0].image!;
    expect(back.behind).toBe(true);
    expect(back.rect).toEqual({ x: 2, y: 1.5, w: 6, h: 4 });
  });

  it("rect なし behind 画像（既定の箱）も同じ箱から動き始め、ドラッグで rect が付く", () => {
    const { slide, layout } = card(`# T\n\n- 本文\n\n![](${IMG}){behind=1}`);
    const { box, aspect } = imageEditGeometry(slide.image!, layout.placeholders);
    expect(box).toEqual(imageRect(slide.image!, imagePlaceholder(layout.placeholders, slide.image!.placeholderIdx)));
    const g = startImageGesture("se", box!, 0, 0);
    moveImageGesture(g, -96, -96, 96, aspect, SLIDE_W, SLIDE_H);
    const rect = endImageGesture(g)!;
    expect(rect.w).toBeLessThan(box!.w); // resized from the SE corner
    expect(rect.x).toBeCloseTo(box!.x, 9); // NW anchor fixed
    expect(serializeMd({ slides: [commit(slide, rect)] })).toMatch(/\{x=[\d.]+,y=[\d.]+,w=[\d.]+,h=[\d.]+,behind=1\}/);
  });

  it("3px 未満はクリック扱い＝コミットしない（前面と同じしきい値）", () => {
    const g = startImageGesture("move", { x: 1, y: 1, w: 2, h: 2 }, 10, 10);
    expect(moveImageGesture(g, 11, 11, 96, 1, SLIDE_W, SLIDE_H)).toBeNull();
    expect(endImageGesture(g)).toBeNull();
  });
});

describe("#122 R8: プレビューのドラッグ基準とフォーム数値は同じ幾何（一致テスト）", () => {
  it.each([
    ["behind・rect あり", BEHIND_MD],
    ["behind・rect なし", `# T\n\n- 本文\n\n![](${IMG}){behind=1}`],
    ["前面・rect なし", `# 画像\n\n![](${IMG})`],
    ["前面・ar あり", `# 画像\n\n![](${IMG}){x=1,y=1.5,w=4,h=3,ar=1.3333}`],
  ])("%s", (_label, md) => {
    const { slide, layout } = card(md);
    const img = slide.image!;
    // SlideEditor の従来式（imagePlaceholder → imageRect → imageAspectRatio）と一致する
    const formBox = imageRect(img, imagePlaceholder(layout.placeholders, img.placeholderIdx));
    const g = imageEditGeometry(img, layout.placeholders);
    expect(g.box).toEqual(formBox);
    expect(g.aspect).toBe(imageAspectRatio(img, formBox));
  });
});
