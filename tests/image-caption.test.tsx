/**
 * image-caption.test.tsx — #399: 画像の alt をキャプション（図版直下の説明/出典 1 行）として描画し、
 * <p:cNvPr descr> にアクセシビリティ属性として書く。
 *
 *   - alt 非空 → 画像（fit 後の実描画 rect）の直下にキャプション shape、<p:pic> の cNvPr に descr
 *   - alt 空   → キャプションも descr も出さない（既存デッキは slide XML 完全一致＝byte-identical）
 *   - behind（最背面）画像 → descr のみ（背景レイヤーの直下に説明行は置かない）
 *   - 文字色は画像が入るプレースホルダの本文色（レイアウト→マスター解決済み）＝暗色テンプレでも読める。
 *     取れないときだけ中立グレー（CAPTION_COLOR）
 *   - PPTX（placeholder-filler）と プレビュー（SlideCard）は同じ imageCaption を通る（R8 一致テスト）
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMd } from "../src/engine/md-parser";
import { generatePptx } from "../src/engine/placeholder-filler";
import { loadTemplate, findLayout, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { imagePlaceholder, imageRect, fitImageInBox } from "../src/engine/visual-placement";
import { imageCaption, CAPTION_H, CAPTION_COLOR } from "../src/engine/image-caption";
import { SlideCard, SLIDE_W, SLIDE_H } from "../src/components/SlidePreview";
import type { DeckIR, ImageBlock } from "../src/engine/slide-schema";

const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");
const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const img = (over: Partial<ImageBlock>): ImageBlock => ({ src: IMG, alt: "", placeholderIdx: "1", ...over });

let tpl: TemplateData;
let midnight: TemplateData;
beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(REPORT));
  midnight = await loadTemplate(readFileSync(MIDNIGHT));
});

async function slideXml(md: string, t: TemplateData = tpl): Promise<string> {
  const deck = parseMd(md);
  deck.template = undefined;
  const zip = await JSZip.loadAsync(await generatePptx(deck, t));
  return zip.file("ppt/slides/slide1.xml")!.async("string");
}

/** The <a:off>/<a:ext> of the first shape whose cNvPr name matches. */
function xfrmOf(xml: string, name: string) {
  const m = xml.match(new RegExp(`name="${name}"[\\s\\S]*?<a:off x="(\\d+)" y="(\\d+)"/><a:ext cx="(\\d+)" cy="(\\d+)"/>`));
  if (!m) return undefined;
  return { x: +m[1], y: +m[2], cx: +m[3], cy: +m[4] };
}

describe("imageCaption — 共有の配置計算（純粋）", () => {
  const box = { x: 1, y: 1, w: 6, h: 4 };

  it("alt 空 → キャプション無し", () => {
    expect(imageCaption(img({ alt: "" }), box)).toBeUndefined();
    expect(imageCaption(img({ alt: "   " }), box)).toBeUndefined();
  });

  it("alt 非空 → box 幅・fit 後の画像下端の直下に 1 行", () => {
    const cap = imageCaption(img({ alt: "出典: 社内調査" }), box)!;
    expect(cap.text).toBe("出典: 社内調査");
    expect(cap.rect).toEqual({ x: 1, y: 5, w: 6, h: CAPTION_H });
  });

  it("contain の letterbox では box 下端でなく実際の画像下端の直下に付く", () => {
    const image = img({ alt: "横長", aspect: 3 }); // 6×2 に縮む → box 内で縦中央
    const fitted = fitImageInBox(box, image.fit, image.aspect).rect;
    const cap = imageCaption(image, box)!;
    expect(cap.rect.y).toBeCloseTo(fitted.y + fitted.h, 9);
    expect(cap.rect.y).toBeCloseTo(4, 9);
  });

  it("スライド下端をはみ出す場合は下端に収める", () => {
    const cap = imageCaption(img({ alt: "下端" }), { x: 1, y: 3, w: 6, h: 4.4 }, undefined, 7.5)!;
    expect(cap.rect.y).toBeCloseTo(7.5 - CAPTION_H, 9);
  });

  it("文字色は渡されたテンプレ本文色、無ければ中立グレー", () => {
    expect(imageCaption(img({ alt: "色" }), box, "E2E8F0")!.color).toBe("E2E8F0");
    expect(imageCaption(img({ alt: "色" }), box)!.color).toBe(CAPTION_COLOR);
  });

  it("behind（最背面）画像にはキャプションを付けない", () => {
    expect(imageCaption(img({ alt: "背景", behind: true }), box)).toBeUndefined();
  });
});

describe("PPTX export — alt → キャプション + descr (#399)", () => {
  it("alt 付き画像 → descr とキャプションテキストが存在し、キャプション box が画像直下にある", async () => {
    const xml = await slideXml(`# 画像\n\n![東京オフィスの受付](${IMG})`);
    expect(xml).toMatch(/<p:cNvPr id="\d+" name="Image" descr="東京オフィスの受付"\/>/);
    expect(xml).toContain("<a:t>東京オフィスの受付</a:t>");
    const pic = xfrmOf(xml, "Image")!;
    const cap = xfrmOf(xml, "ImageCaption")!;
    expect(pic).toBeDefined();
    expect(cap).toBeDefined();
    // 直下（EMU 丸め誤差 1 以内）かつ画像と水平に重なる
    expect(Math.abs(cap.y - (pic.y + pic.cy))).toBeLessThanOrEqual(1);
    expect(cap.x).toBeLessThanOrEqual(pic.x);
    expect(cap.x + cap.cx).toBeGreaterThanOrEqual(pic.x + pic.cx - 1);
  });

  it("alt の XML 特殊文字はエスケープされる", async () => {
    const xml = await slideXml(`# 画像\n\n![A&B <c> "d"](${IMG})`);
    expect(xml).toContain(`descr="A&amp;B &lt;c&gt; &quot;d&quot;"`);
    expect(xml).toContain("<a:t>A&amp;B &lt;c&gt; &quot;d&quot;</a:t>");
  });

  it("alt 空 → キャプションも descr も無い（従来どおり）", async () => {
    const xml = await slideXml(`# 画像\n\n![](${IMG})`);
    expect(xml).toContain("<p:pic>");
    expect(xml).not.toContain("descr=");
    expect(xml).not.toContain("ImageCaption");
    expect(xml).toMatch(/<p:cNvPr id="\d+" name="Image"\/>/);
  });

  it("behind 画像 → descr は書くがキャプションは無い", async () => {
    const xml = await slideXml(`# 背景\n\n- 本文\n\n![背景写真](${IMG}){behind=1}`);
    expect(xml).toContain(`name="Image" descr="背景写真"`);
    expect(xml).not.toContain("ImageCaption");
  });
});

describe("プレビュー（SlideCard）— export と同じ配置 (R8 一致テスト)", () => {
  function render(deck: DeckIR, t: TemplateData = tpl) {
    const slide = deck.slides[0];
    // Same resolution as SlidePreview / generatePptx: autoSelectLayout (honors a pin) → findLayout.
    const layout = findLayout(t, autoSelectLayout(slide, 0, deck.slides.length, buildCatalog(t)));
    const html = renderToStaticMarkup(
      <SlideCard slide={slide} slideIndex={0} totalSlides={1} layout={layout} masterBgColor={t.masterBgColor} scale={96} exportMode />,
    );
    return { slide, layout: layout!, html };
  }
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  it.each([["報告書", () => tpl], ["Midnight", () => midnight]] as const)(
    "%s: alt 付き → export と同じ位置・同じ色（プレースホルダ本文色）でキャプションが出る",
    async (_name, getTpl) => {
      const t = getTpl();
      const md = `# 画像\n\n![東京オフィスの受付](${IMG})`;
      const { slide, layout, html } = render(parseMd(md), t);
      const ph = imagePlaceholder(layout.placeholders, slide.image!.placeholderIdx)!;
      const cap = imageCaption(slide.image!, imageRect(slide.image!, ph)!, ph.style.fontColor)!;
      expect(cap.color).toBe(ph.style.fontColor);
      // preview
      const m = html.match(/<div data-image-caption="true" style="([^"]*)">([^<]*)<\/div>/);
      expect(m).not.toBeNull();
      expect(m![2]).toBe("東京オフィスの受付");
      expect(m![1]).toContain(`left:${pct(cap.rect.x, SLIDE_W)}`);
      expect(m![1]).toContain(`top:${pct(cap.rect.y, SLIDE_H)}`);
      expect(m![1]).toContain(`width:${pct(cap.rect.w, SLIDE_W)}`);
      expect(m![1]).toContain(`height:${pct(cap.rect.h, SLIDE_H)}`);
      expect(m![1]).toContain(`color:#${cap.color}`);
      // export — same color + same rect (EMU)
      const xml = await slideXml(md, t);
      const capXml = xml.slice(xml.indexOf('name="ImageCaption"'));
      expect(capXml).toContain(`<a:srgbClr val="${cap.color}"/>`);
      const x = xfrmOf(xml, "ImageCaption")!;
      const E = (n: number) => Math.round(n * 914400);
      expect(x).toEqual({ x: E(cap.rect.x), y: E(cap.rect.y), cx: E(cap.rect.w), cy: E(cap.rect.h) });
    },
  );

  it("Midnight（暗背景）では固定グレーでなくテンプレの明るい本文色を使う", () => {
    const { slide, layout } = render(parseMd(`# 画像\n\n![受付](${IMG})`), midnight);
    const ph = imagePlaceholder(layout.placeholders, slide.image!.placeholderIdx)!;
    expect(ph.style.fontColor).not.toBe(CAPTION_COLOR);
  });

  it("alt 空 → プレビューにもキャプション無し", () => {
    const { html } = render(parseMd(`# 画像\n\n![](${IMG})`));
    expect(html).not.toContain("data-image-caption");
  });
});
