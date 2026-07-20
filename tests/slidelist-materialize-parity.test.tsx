/**
 * slidelist-materialize-parity.test.tsx — #275: 左サムネイル一覧（SlideList）と右プレビュー
 * （SlidePreview）で派生スライド（<!-- toc -->/章扉の全章リスト再掲）の描画が一致すること。
 *
 * root cause: SlideList.tsx が生の deck.slides を SlideCard に渡し、materializeDerivedSlides
 * （deck-sections.ts）を通していなかった（SlidePreview/PPTX/HTML/スクショは通す）。
 * fix: App が displayDeck = materializeDerivedSlides(deck) を1回だけ作り、SlideList と
 * SlidePreview（preMaterialized）の両方に渡す（App.tsx）。
 *
 * SSR（react-dom/server, no jsdom）で SlideList / SlidePreview を直接レンダーして検証する
 * （このリポジトリの component テストは jsdom を持たないため、SlideCard 系のテストと同じ手法）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMd } from "../src/engine/md-parser";
import { materializeDerivedSlides } from "../src/engine/deck-sections";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import SlideList from "../src/components/SlideList";
import SlidePreview from "../src/components/SlidePreview";
import type { DeckIR } from "../src/engine/slide-schema";

const TPL_PATH = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

// slides: [0] <!-- toc --> (derived) [1] 章扉「現状分析」 [2] 詳細スライド [3] 章扉「解決策」
const MD = `<!-- toc -->

---

<!-- section -->
# 現状分析

> 章の補足説明

---

# 詳細スライド

- 内容

---

<!-- section -->
# 解決策
`;

function renderSlideList(deck: DeckIR, tpl: TemplateData): string {
  return renderToStaticMarkup(
    <SlideList deck={deck} template={tpl} activeIndex={0} onSelect={() => {}} />,
  );
}

describe("#275 SlideList — materialize 済み deck を受け取ると右プレビューと同じ内容を描く", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(TPL_PATH));
  });

  it("bug repro: 生の deck を渡すと目次サムネイルが空・章扉サムネイルにリストが出ない", () => {
    const html = renderSlideList(parseMd(MD), tpl);
    // 目次スライド（derived: "toc", placeholders: []）— materialize 前は見出しも本文も無い。
    expect(html).not.toContain("目次");
    // 章扉の全章リスト再掲（#167）も materialize 前は注入されていない。
    expect(html).not.toContain("1. 現状分析");
    expect(html).not.toContain("2. 解決策");
  });

  it("fix: materializeDerivedSlides 済みの deck を渡すと目次・章扉の再掲がサムネイルに出る", () => {
    const html = renderSlideList(materializeDerivedSlides(parseMd(MD)), tpl);
    expect(html).toContain("目次");
    expect(html).toContain("1. 現状分析");
    expect(html).toContain("2. 解決策");
  });

  it("非派生スライド（章タグ/toc 無し）のサムネイルは materialize 前後で回帰なし（同一 HTML）", () => {
    const plain = parseMd("# T\n\n- a\n\n---\n\n# U\n\n- b");
    expect(renderSlideList(plain, tpl)).toBe(renderSlideList(materializeDerivedSlides(plain), tpl));
  });
});

describe("#275 SlideList ⇔ SlidePreview 一致 — 同じ materialize 済み deck を渡すと同じ内容を描く", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(TPL_PATH));
  });

  it("目次スライド（index 0）: SlideList のサムネイルと SlidePreview の中身が一致する", () => {
    const displayDeck = materializeDerivedSlides(parseMd(MD));
    const listHtml = renderSlideList(displayDeck, tpl);
    const previewHtml = renderToStaticMarkup(
      <SlidePreview deck={displayDeck} preMaterialized template={tpl} error={null} activeSlide={0} singleSlide />,
    );
    for (const text of ["目次", "1. 現状分析", "2. 解決策"]) {
      expect(listHtml).toContain(text);
      expect(previewHtml).toContain(text);
    }
  });

  it("章扉スライド（index 1・現状分析）: サムネイルとプレビューの両方に全章リスト再掲が出る", () => {
    const displayDeck = materializeDerivedSlides(parseMd(MD));
    const listHtml = renderSlideList(displayDeck, tpl);
    const previewHtml = renderToStaticMarkup(
      <SlidePreview deck={displayDeck} preMaterialized template={tpl} error={null} activeSlide={1} singleSlide />,
    );
    // SlideList は全スライドを1回でレンダーするので、章扉(index1)の再掲もリストに含まれる。
    for (const text of ["1. 現状分析", "2. 解決策"]) {
      expect(listHtml).toContain(text);
      expect(previewHtml).toContain(text);
    }
  });
});

describe("#275 SlidePreview — preMaterialized で二重 materialize を回避（App からの1回呼び出し前提）", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(TPL_PATH));
  });

  it("preMaterialized 省略（既定 false）: 生 deck を渡しても従来どおり内部で materialize される（互換）", () => {
    const html = renderToStaticMarkup(
      <SlidePreview deck={parseMd(MD)} template={tpl} error={null} activeSlide={0} singleSlide />,
    );
    expect(html).toContain("目次");
    expect(html).toContain("1. 現状分析");
  });

  it("preMaterialized=true: 既に materialize 済みの deck をそのまま描く（再 materialize しても結果は不変・冪等）", () => {
    const displayDeck = materializeDerivedSlides(parseMd(MD));
    const html = renderToStaticMarkup(
      <SlidePreview deck={displayDeck} preMaterialized template={tpl} error={null} activeSlide={0} singleSlide />,
    );
    expect(html).toContain("目次");
    expect(html).toContain("1. 現状分析");
  });

  it("preMaterialized=true は内部 materialize を実際に省く: 生 deck を渡すと（呼び出し側の契約違反として）materialize されない", () => {
    // このケースは実際の呼び出し（App は必ず materialize 済みを渡す）では起きないが、preMaterialized
    // が「素通し」であって「無条件に materialize する」のフォールバックでないことを示す — フラグが
    // 名ばかりの no-op ではないことの確認。
    const html = renderToStaticMarkup(
      <SlidePreview deck={parseMd(MD)} preMaterialized template={tpl} error={null} activeSlide={0} singleSlide />,
    );
    expect(html).not.toContain("目次");
    expect(html).not.toContain("1. 現状分析");
  });
});
