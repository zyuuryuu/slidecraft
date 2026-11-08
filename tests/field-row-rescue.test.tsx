/**
 * field-row-rescue.test.tsx — #597（#580 段 2-e）: `Category:` / `Source:` / `Takeaway:` の受け枠
 * （専用枠）が無いテンプレでの「決まった代替」への救済（never-silent＝内容を黙って落とさない）。
 *
 *   - Category:（表紙）→ 副題の末尾に 1 行足す（副題枠が空なら副題として出す）
 *   - Source:          → 内容領域のすぐ下に小さな出典行（図形のテキストボックス）を描く
 *   - Takeaway:        → 本文の先頭に太字の 1 行を足す（本文が無いスライドでは救済しない＝warn のまま）
 *
 * 救済したら `get_deck_issues` に info（field-row-rescued）を 1 件出す。受け枠があるテンプレ
 * （公文書高密度の `出典`・Midnight の Callout/Source）は従来どおり枠に入り、救済は 0（byte-identical）。
 * export（placeholder-filler）・プレビュー（SlideCard）・診断（slideBindingPlan）は同じ
 * planFieldRescue を通る（R8）ので、ここで 3 経路の一致を確かめる。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTemplate, autoSelectLayout, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { slideBindingPlan } from "../src/engine/group-binding";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { generatePptx } from "../src/engine/placeholder-filler";
import { SlideCard } from "../src/components/SlidePreview";
import type { DeckIR } from "../src/engine/slide-schema";

const GIJUTSU = resolve(__dirname, "../public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx");
const KOUBUNSHO = resolve(__dirname, "../public/templates/slide/配布資料_公文書高密度_TemplateOnly.pptx");
const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

const COVER = "# 社内ナレッジ検索の導入\n> 探す時間を考える時間へ\n\nCategory: ご提案\nDate: 2026-11";
const TABLE_SOURCE = "# 地域別人口\n\n| 地域 | 人口 |\n|---|---|\n| 東京 | 1400万 |\n\nSource: 総務省 2025";
const BODY_TAKEAWAY = "# 売上は回復基調\n\n- 3Q は前年比 +12%\n- 新規顧客が牽引\n\nTakeaway: 結論はこれ";
const CARD_TAKEAWAY = "# 3 つの課題\n\n<!-- card -->\n### 散在\n- a\n\n<!-- card -->\n### 属人化\n- b\n\n<!-- card -->\n### 取りこぼし\n- c\n\nTakeaway: 再利用できていない";
const deckOf = (...mds: string[]): DeckIR => parseMd(mds.join("\n\n---\n\n"));

let gijutsu: TemplateData;
let koubun: TemplateData;
let midnight: TemplateData;
beforeAll(async () => {
  [gijutsu, koubun, midnight] = await Promise.all([GIJUTSU, KOUBUNSHO, MIDNIGHT].map((p) => loadTemplate(readFileSync(p))));
});

const layoutOf = (tpl: TemplateData, deck: DeckIR, i: number) =>
  findLayout(tpl, autoSelectLayout(deck.slides[i], i, deck.slides.length, buildCatalog(tpl)))!;
const issuesOf = (tpl: TemplateData, deck: DeckIR) => diagnoseDeck(deck, buildCatalog(tpl), tpl.layouts);
const slideXml = async (tpl: TemplateData, deck: DeckIR, i: number) =>
  (await JSZip.loadAsync(await generatePptx(deck, tpl))).file(`ppt/slides/slide${i + 1}.xml`)!.async("string");
const cardHtml = (tpl: TemplateData, deck: DeckIR, i: number) =>
  renderToStaticMarkup(
    <SlideCard slide={deck.slides[i]} slideIndex={i} totalSlides={deck.slides.length} layout={layoutOf(tpl, deck, i)}
      masterBgColor={tpl.masterBgColor} masterDecorations={tpl.masterDecorations} masterStaticTexts={tpl.masterStaticTexts} scale={96} exportMode />,
  );
/** The <p:sp> that carries `text` in a slide XML, or undefined. */
const spWith = (xml: string, text: string) => xml.split("<p:sp>").find((x) => x.includes(text));

describe("(a) 技術報告: Source: 付きの表スライド → 内容の下に出典行・info 1 件", () => {
  it("binding plan reports the row as rescued via a note (still not bound to a slot)", () => {
    const deck = deckOf(COVER, TABLE_SOURCE);
    const plan = slideBindingPlan(deck.slides[1], layoutOf(gijutsu, deck, 1));
    expect(plan.unbound.map((u) => u.idx)).toEqual(["source"]);
    expect(plan.rescued?.map((r) => [r.kind, r.via])).toEqual([["source", "note"]]);
  });

  it("get_deck_issues: no unbound-content warn for the row, exactly one field-row-rescued info", () => {
    const deck = deckOf(COVER, TABLE_SOURCE);
    const issues = issuesOf(gijutsu, deck).filter((x) => x.slideIndex === 1);
    expect(issues.filter((x) => x.id === "unbound-content")).toEqual([]);
    const info = issues.filter((x) => x.id === "field-row-rescued");
    expect(info).toHaveLength(1);
    expect(info[0].level).toBe("info");
    expect(info[0].message).toContain("Source:");
  });

  it("the PPTX carries the source line as a small text box right under the content box (y = 6.70in)", async () => {
    const deck = deckOf(COVER, TABLE_SOURCE);
    const sp = spWith(await slideXml(gijutsu, deck, 1), "出典：総務省 2025");
    expect(sp).toBeDefined();
    expect(sp).toContain('name="FieldNote"');
    expect(sp).toContain(`<a:off x="${Math.round(0.6 * 914400)}" y="${Math.round(6.7 * 914400)}"/>`);
    expect(sp).toMatch(/sz="900"/);
  });

  it("the preview (SlideCard SSR) draws the same line", () => {
    const deck = deckOf(COVER, TABLE_SOURCE);
    const html = cardHtml(gijutsu, deck, 1);
    expect(html).toContain('data-field-note="true"');
    expect(html).toContain("出典：総務省 2025");
  });
});

describe("(b) 公文書高密度: 受け枠（出典）があるので従来どおり枠に入り info ゼロ", () => {
  it("binds into 出典, no rescue, no info, no FieldNote shape", async () => {
    const deck = deckOf(COVER.replace("Category: ご提案\n", ""), TABLE_SOURCE);
    const layout = layoutOf(koubun, deck, 1);
    const plan = slideBindingPlan(deck.slides[1], layout);
    expect(plan.unbound).toEqual([]);
    expect(plan.rescued ?? []).toEqual([]);
    expect(issuesOf(koubun, deck).filter((x) => x.id === "field-row-rescued")).toEqual([]);
    const xml = await slideXml(koubun, deck, 1);
    expect(xml).not.toContain("FieldNote");
    expect(spWith(xml, "総務省 2025")).toMatch(/<p:ph[^>]*idx="30"/);
  });
});

describe("Takeaway: → 本文先頭の太字行", () => {
  it("技術報告 body slide: the body box starts with the bold takeaway; info 1, no warn", async () => {
    const deck = deckOf(COVER, BODY_TAKEAWAY);
    const plan = slideBindingPlan(deck.slides[1], layoutOf(gijutsu, deck, 1));
    expect(plan.rescued?.map((r) => [r.kind, r.via])).toEqual([["callout", "body-head"]]);
    const issues = issuesOf(gijutsu, deck).filter((x) => x.slideIndex === 1);
    expect(issues.filter((x) => x.id === "unbound-content")).toEqual([]);
    expect(issues.filter((x) => x.id === "field-row-rescued")).toHaveLength(1);
    const sp = spWith(await slideXml(gijutsu, deck, 1), "結論はこれ")!;
    expect(sp).toMatch(/<p:ph[^>]*idx="1"/);
    expect(sp.indexOf("結論はこれ")).toBeLessThan(sp.indexOf("3Q は前年比"));
    expect(sp.slice(0, sp.indexOf("結論はこれ"))).toMatch(/b="1"[^>]*>(?:(?!<a:r>).)*$/s);
    expect(cardHtml(gijutsu, deck, 1)).toContain("結論はこれ");
  });

  it("a grouped (card) slide has no body to prepend to → stays an unbound-content warn (never-silent)", () => {
    const deck = deckOf(COVER, CARD_TAKEAWAY);
    const plan = slideBindingPlan(deck.slides[1], layoutOf(gijutsu, deck, 1));
    expect(plan.rescued ?? []).toEqual([]);
    const issues = issuesOf(gijutsu, deck).filter((x) => x.slideIndex === 1);
    expect(issues.filter((x) => x.id === "unbound-content")).toHaveLength(1);
    expect(issues.filter((x) => x.id === "field-row-rescued")).toEqual([]);
  });
});

describe("Category:（表紙）→ 副題の末尾", () => {
  it("技術報告 cover: the subtitle box ends with the category line; info 1, no warn", async () => {
    const deck = deckOf(COVER, BODY_TAKEAWAY);
    const plan = slideBindingPlan(deck.slides[0], layoutOf(gijutsu, deck, 0));
    expect(plan.rescued?.map((r) => [r.kind, r.via])).toEqual([["category", "subtitle-tail"]]);
    const issues = issuesOf(gijutsu, deck).filter((x) => x.slideIndex === 0);
    expect(issues.filter((x) => x.id === "unbound-content")).toEqual([]);
    expect(issues.filter((x) => x.id === "field-row-rescued")).toHaveLength(1);
    const sp = spWith(await slideXml(gijutsu, deck, 0), "ご提案")!;
    expect(sp).toContain("探す時間を考える時間へ");
    expect(sp.indexOf("探す時間を考える時間へ")).toBeLessThan(sp.indexOf("ご提案"));
    expect(cardHtml(gijutsu, deck, 0)).toContain("ご提案");
  });
});

describe("do-no-harm: templates that have the slots, and row-less decks, never rescue", () => {
  it("Midnight (Callout/Source variants + category slot) → no rescue on any slide", () => {
    const deck = deckOf(COVER, TABLE_SOURCE, BODY_TAKEAWAY);
    deck.slides.forEach((s, i) => expect(slideBindingPlan(s, layoutOf(midnight, deck, i)).rescued ?? []).toEqual([]));
    expect(issuesOf(midnight, deck).filter((x) => x.id === "field-row-rescued")).toEqual([]);
  });

  it("a deck without field rows / Category has no rescue on any shipped template", () => {
    const deck = deckOf("# 表紙\n> 副題", "# 本文\n\n- a\n- b", "# 表\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    for (const tpl of [gijutsu, koubun, midnight]) {
      deck.slides.forEach((s, i) => expect(slideBindingPlan(s, layoutOf(tpl, deck, i)).rescued ?? []).toEqual([]));
    }
  });

  it("the rescue is render-only: Markdown round-trip with the template keeps the rows as rows", () => {
    const deck = deckOf(COVER, TABLE_SOURCE, BODY_TAKEAWAY);
    const md = serializeMd(deck, { catalog: buildCatalog(gijutsu), layouts: gijutsu.layouts });
    expect(md).toContain("Source: 総務省 2025");
    expect(md).toContain("Takeaway: 結論はこれ");
    expect(md).toContain("Category: ご提案");
    expect(md).not.toContain("出典：");
  });
});
