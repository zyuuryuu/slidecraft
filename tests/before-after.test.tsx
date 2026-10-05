/**
 * before-after.test.tsx — #402: Before/After（As-is → To-be）の方向付き 2 面構造。
 *
 * 記法は `<!-- before -->` / `<!-- after -->` の対（groupKind "beforeAfter"）。compare（#396）の亜種で、
 * レイアウトは compare 系（Compare.2Option.Versus / 12_課題と対策）を共用し、その上に
 *   - 左右の領域の間に方向矢印 1 シェイプ（右向き。縦積みなら下向き）
 *   - 各領域の上に役割ラベル（1 つ目が Before・2 つ目以降が After）
 * を重ねる。意味は位置で決まる（1 つ目のセル＝Before）。矢印とラベルの位置は engine の
 * beforeAfterOverlay が 1 回だけ計算し、PPTX（placeholder-filler）とプレビュー（SlideCard）の両方が
 * それを使う（R8 一致テスト）。色はテーマ色（accent1 / lt1）。
 *
 * 不変条件: 通常 compare・card/step/kpi・マーカー無しスライドには何も足さない（overlay undefined ＝
 * slide XML に BeforeAfter シェイプが出ない）。round-trip 安定。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { generatePptx } from "../src/engine/placeholder-filler";
import { loadTemplate, findLayout, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { expandGroups } from "../src/engine/group-binding";
import { beforeAfterOverlay, arrowPolygon, overlayColors, BA_LABEL_TEXT } from "../src/engine/before-after";
import { SlideCard, SLIDE_W, SLIDE_H } from "../src/components/SlidePreview";
import type { DeckIR, SlideIR } from "../src/engine/slide-schema";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");

const BA_MD = `# 承認フローの見直し

<!-- before -->
### 現状
- 紙の申請書を回覧
- 承認まで平均 5 日

<!-- after -->
### 見直し後
- ワークフローで電子承認
- 承認まで平均 1 日`;

const text = (paras: { segments: { text: string }[] }[] | undefined) =>
  (paras ?? []).map((p) => p.segments.map((s) => s.text).join("")).join("|");

let midnight: TemplateData;
let cat: LayoutCatalog;
let report: TemplateData;
beforeAll(async () => {
  midnight = await loadTemplate(readFileSync(MIDNIGHT));
  cat = buildCatalog(midnight);
  report = await loadTemplate(readFileSync(REPORT));
});

const layoutFor = (s: SlideIR, t: TemplateData = midnight) =>
  findLayout(t, autoSelectLayout(s, 1, 3, t === midnight ? cat : buildCatalog(t)))!;

async function slideXml(md: string, t: TemplateData = midnight): Promise<string> {
  // A 1-slide deck's slide 0 coerces to the cover; pad a cover in front so the slide under test is a content slide.
  const deck = parseMd(`# 表紙\n\n---\n\n${md}`);
  deck.template = undefined;
  const zip = await JSZip.loadAsync(await generatePptx(deck, t));
  return zip.file("ppt/slides/slide2.xml")!.async("string");
}

/** The <a:off>/<a:ext> of the first shape whose cNvPr name matches. */
function xfrmOf(xml: string, name: string) {
  const m = xml.match(new RegExp(`name="${name}"[\\s\\S]*?<a:off x="(\\d+)" y="(\\d+)"/><a:ext cx="(\\d+)" cy="(\\d+)"/>`));
  return m ? { x: +m[1], y: +m[2], cx: +m[3], cy: +m[4] } : undefined;
}
const E = (n: number) => Math.round(n * 914400);

describe("#402 parse — `<!-- before -->` / `<!-- after -->`", () => {
  it("the pair → groupKind beforeAfter, cell 1 = before content, cell 2 = after content", () => {
    const s = parseMd(BA_MD).slides[0];
    expect(s.groupKind).toBe("beforeAfter");
    expect(text(s.placeholders.find((p) => p.idx === "1")!.paragraphs)).toContain("紙の申請書を回覧");
    expect(text(s.placeholders.find((p) => p.idx === "2")!.paragraphs)).toContain("ワークフローで電子承認");
  });

  it("auto selection lands on the compare family (Compare.2Option.Versus), each cell in its own label + body", () => {
    const s = parseMd(BA_MD).slides[0];
    const layout = layoutFor(s);
    expect(layout.name).toBe("Compare.2Option.Versus");
    const out = expandGroups(s, layout);
    expect(text(out.get("1")?.paragraphs)).toBe("現状");
    expect(text(out.get("2")?.paragraphs)).toContain("承認まで平均 5 日");
    expect(text(out.get("3")?.paragraphs)).toBe("見直し後");
    expect(text(out.get("4")?.paragraphs)).toContain("承認まで平均 1 日");
  });

  it("report template → 12_課題と対策", () => {
    expect(layoutFor(parseMd(BA_MD).slides[0], report).name).toBe("12_課題と対策");
  });
});

describe("#402 round-trip", () => {
  const strip = (d: DeckIR) => d.slides.map((s) => ({ ...s, sourceLineStart: undefined, sourceLineEnd: undefined }));

  it("the markers survive (cell 1 → before, cell 2 → after), md stable, IR identical — with and without a template", () => {
    const deck = parseMd(BA_MD);
    for (const t of [undefined, { catalog: cat, layouts: midnight.layouts }]) {
      const once = serializeMd(deck, t);
      expect(once.match(/<!-- before -->/g)).toHaveLength(1);
      expect(once.match(/<!-- after -->/g)).toHaveLength(1);
      expect(once.indexOf("<!-- before -->")).toBeLessThan(once.indexOf("<!-- after -->"));
      expect(once).not.toMatch(/<!-- (compare|col|card|kpi|step|beforeAfter) -->/);
      const re = parseMd(once);
      expect(strip(re)).toEqual(strip(deck));
      expect(serializeMd(re, t)).toBe(once);
    }
  });

  it("meaning is positional: a mislabelled order normalizes to what is drawn, and is stable from then on", () => {
    const deck = parseMd("# T\n\n<!-- after -->\nA\n\n<!-- before -->\nB");
    expect(deck.slides[0].groupKind).toBe("beforeAfter");
    const once = serializeMd(deck);
    expect(once).toMatch(/<!-- before -->\nA\n\n<!-- after -->\nB/);
    expect(strip(parseMd(once))).toEqual(strip(deck));
  });
});

describe("#402 overlay geometry (engine, shared by export and preview)", () => {
  it("arrow sits in the gap between the two columns, pointing right; labels sit above each column", () => {
    const s = parseMd(BA_MD).slides[0];
    const layout = layoutFor(s);
    const o = beforeAfterOverlay(s, layout)!;
    const ph = (idx: string) => layout.placeholders.find((p) => p.idx === idx)!.style;
    const leftRight = ph("2").x + ph("2").w; // OptionContent1 right edge
    const rightLeft = ph("3").x; // OptionLabel2 left edge
    expect(o.arrow!.dir).toBe("right");
    expect(o.arrow!.rect.x).toBeGreaterThanOrEqual(leftRight);
    expect(o.arrow!.rect.x + o.arrow!.rect.w).toBeLessThanOrEqual(rightLeft);
    expect(o.labels.map((l) => [l.text, l.filled])).toEqual([[BA_LABEL_TEXT.before, false], [BA_LABEL_TEXT.after, true]]);
    expect(o.labels[0].rect.x).toBeCloseTo(ph("1").x, 9);
    expect(o.labels[1].rect.x).toBeCloseTo(ph("3").x, 9);
    for (const [l, top] of [[o.labels[0], ph("1")], [o.labels[1], ph("3")]] as const) {
      expect(l.rect.y + l.rect.h).toBeLessThanOrEqual(top.y); // above the column…
      expect(l.rect.y).toBeGreaterThanOrEqual(ph("16").y + ph("16").h); // …and below the subtitle band
    }
  });

  it("no overlay for anything that is not before/after (compare, card, plain) — nothing is added", () => {
    const cmp = parseMd(BA_MD.replace("<!-- before -->", "<!-- compare -->").replace("<!-- after -->", "<!-- compare -->")).slides[0];
    expect(beforeAfterOverlay(cmp, layoutFor(cmp))).toBeUndefined();
    const card = parseMd("# T\n\n<!-- card -->\n### a\n- x\n\n<!-- card -->\n### b\n- y").slides[0];
    expect(beforeAfterOverlay(card, layoutFor(card))).toBeUndefined();
    const plain = parseMd("# T\n\n- a\n- b").slides[0];
    expect(beforeAfterOverlay(plain, layoutFor(plain))).toBeUndefined();
  });

  it("a lone cell gets no arrow (nothing to point at) but keeps its label", () => {
    const s = parseMd("# T\n\n<!-- before -->\n- only").slides[0];
    const o = beforeAfterOverlay(s, layoutFor(s))!;
    expect(o.arrow).toBeUndefined();
    expect(o.labels.map((l) => l.text)).toEqual([BA_LABEL_TEXT.before]);
  });

  it("arrowPolygon is PowerPoint's rightArrow default geometry (shaft 50%, head = half the short side)", () => {
    const pts = arrowPolygon({ dir: "right", rect: { x: 0, y: 0, w: 2, h: 1 } });
    expect(pts).toEqual([[0, 0.25], [1.5, 0.25], [1.5, 0], [2, 0.5], [1.5, 1], [1.5, 0.75], [0, 0.75]]);
  });

  it("colors are the theme's accent1 / lt1, with neutral fallbacks", () => {
    expect(overlayColors({ accent1: "112233", lt1: "FAFAFA" })).toEqual({ accent: "112233", onAccent: "FAFAFA" });
    expect(overlayColors(undefined)).toEqual({ accent: "4472C4", onAccent: "FFFFFF" });
  });
});

describe("#402 overlay — templates that already draw the direction (report family)", () => {
  const KOUBUN = resolve(__dirname, "fixtures/templates/配布資料_公文書高密度_全レイアウト見本.pptx");

  it("12_課題と対策 bakes its own rightArrow in the gap → ours is not drawn (no double arrow); labels still are", () => {
    const s = parseMd(BA_MD).slides[0];
    const layout = layoutFor(s, report);
    expect(layout.decorations.some((d) => d.prst === "rightArrow" && d.x > 6 && d.x + d.w < 7.4)).toBe(true);
    const o = beforeAfterOverlay(s, layout)!;
    expect(o.arrow).toBeUndefined();
    expect(o.labels.map((l) => l.text)).toEqual(["Before", "After"]);
  });

  it("公文書高密度 (cells start right under the title band): labels never cover the title, and hang at the cell's right end", async () => {
    const t = await loadTemplate(readFileSync(KOUBUN));
    const s = parseMd(BA_MD).slides[0];
    const layout = layoutFor(s, t);
    expect(layout.name).toBe("12_論点と対応");
    const o = beforeAfterOverlay(s, layout)!;
    const title = layout.placeholders.find((p) => p.type === "title")!.style;
    const heads = ["13", "15"].map((i) => layout.placeholders.find((p) => p.idx === i)!.style);
    o.labels.forEach((l, i) => {
      expect(l.rect.y).toBeGreaterThanOrEqual(title.y + title.h);
      expect(l.rect.x + l.rect.w).toBeLessThanOrEqual(heads[i].x + heads[i].w);
      expect(l.rect.x).toBeGreaterThan(heads[i].x + heads[i].w / 2); // right half, clear of the left-aligned heading
    });
  });
});

describe("#402 PPTX export", () => {
  it("2 cells in separate bodies + a right-arrow shape + a role label per cell (theme colors)", async () => {
    const xml = await slideXml(BA_MD);
    // separate bodies
    expect(xml).toContain("<a:t>紙の申請書を回覧</a:t>");
    expect(xml).toContain("<a:t>ワークフローで電子承認</a:t>");
    // arrow
    const arrow = xml.slice(xml.indexOf('name="BeforeAfterArrow"'));
    expect(arrow).toMatch(/^name="BeforeAfterArrow"[\s\S]*?<a:prstGeom prst="rightArrow">[\s\S]*?<a:schemeClr val="accent1"\/>/);
    // labels
    expect(xml).toMatch(/name="BeforeAfterLabel1"[\s\S]*?<a:t>Before<\/a:t>/);
    expect(xml).toMatch(/name="BeforeAfterLabel2"[\s\S]*?<a:t>After<\/a:t>/);
    // Before = lt1 chip outlined in accent1; After = accent1 chip outlined in lt1 (opaque on any band)
    expect(xml).toMatch(/name="BeforeAfterLabel1"[\s\S]*?<\/a:prstGeom><a:solidFill><a:schemeClr val="lt1"\/><\/a:solidFill><a:ln w="12700"><a:solidFill><a:schemeClr val="accent1"\/>/);
    expect(xml).toMatch(/name="BeforeAfterLabel2"[\s\S]*?<\/a:prstGeom><a:solidFill><a:schemeClr val="accent1"\/><\/a:solidFill><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"\/>/);
    // geometry == the shared overlay
    const s = parseMd(BA_MD).slides[0];
    const o = beforeAfterOverlay(s, layoutFor(s))!;
    const r = o.arrow!.rect;
    expect(xfrmOf(xml, "BeforeAfterArrow")).toEqual({ x: E(r.x), y: E(r.y), cx: E(r.w), cy: E(r.h) });
    const l = o.labels[1].rect;
    expect(xfrmOf(xml, "BeforeAfterLabel2")).toEqual({ x: E(l.x), y: E(l.y), cx: E(l.w), cy: E(l.h) });
    // unique shape ids
    const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a normal compare slide carries no Before/After shapes", async () => {
    const xml = await slideXml(BA_MD.replace("<!-- before -->", "<!-- compare -->").replace("<!-- after -->", "<!-- compare -->"));
    expect(xml).not.toContain("BeforeAfter");
    expect(xml).toContain("<a:t>紙の申請書を回覧</a:t>");
  });
});

describe("#402 preview (SlideCard) — same geometry as the export (R8)", () => {
  it("draws the arrow + both labels at the overlay's rects, in the theme's accent color", () => {
    const deck = parseMd(BA_MD);
    const slide = deck.slides[0];
    const layout = layoutFor(slide);
    const html = renderToStaticMarkup(
      <SlideCard slide={slide} slideIndex={1} totalSlides={3} layout={layout} masterBgColor={midnight.masterBgColor}
        themeColors={midnight.themeColors} scale={96} exportMode />,
    );
    const o = beforeAfterOverlay(slide, layout)!;
    const pct = (v: number, of: number) => `${(v / of) * 100}%`;
    const { accent } = overlayColors(midnight.themeColors);
    const arrow = html.match(/<svg data-before-after="arrow" style="([^"]*)"[^>]*>([\s\S]*?)<\/svg>/);
    expect(arrow).not.toBeNull();
    expect(arrow![1]).toContain(`left:${pct(o.arrow!.rect.x, SLIDE_W)}`);
    expect(arrow![1]).toContain(`top:${pct(o.arrow!.rect.y, SLIDE_H)}`);
    expect(arrow![2]).toContain(`fill="#${accent}"`);
    const labels = [...html.matchAll(/<div data-before-after="label" style="([^"]*)">([^<]*)<\/div>/g)];
    expect(labels.map((m) => m[2])).toEqual(["Before", "After"]);
    expect(labels[1][1]).toContain(`left:${pct(o.labels[1].rect.x, SLIDE_W)}`);
    expect(labels[1][1]).toContain(`background-color:#${accent}`);
  });

  it("a compare slide renders no overlay", () => {
    const slide = parseMd(BA_MD.replace("<!-- before -->", "<!-- compare -->").replace("<!-- after -->", "<!-- compare -->")).slides[0];
    const html = renderToStaticMarkup(
      <SlideCard slide={slide} slideIndex={1} totalSlides={3} layout={layoutFor(slide)} masterBgColor={midnight.masterBgColor}
        themeColors={midnight.themeColors} scale={96} exportMode />,
    );
    expect(html).not.toContain("data-before-after");
  });
});
