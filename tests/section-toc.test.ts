/**
 * section-toc.test.ts — #151 / ADR-0032 D2: `<!-- section -->` 章タグ＋採番＋`<!-- toc -->` 目次。
 *
 * - 章扉は著者が書く普通のスライド＋タグで章境界を宣言（sectionBreak: true）
 * - `<!-- toc -->` のみのブロック → 導出専用の派生スライド（derived: "toc"）。内容は常に
 *   section タグ付きスライドのタイトルから再導出し、DeckIR に複製状態を持たない（R8）
 * - Markdown へは `<!-- toc -->` の 1 行のみ書き戻す（materialize 後でも）
 * - 宣言なし md は新コードパスに入らず byte-identical
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { scanSections, tocParagraphs, materializeDerivedSlides } from "../src/engine/deck-sections";
import { generatePptx } from "../src/engine/placeholder-filler";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import type { DeckIR } from "../src/engine/slide-schema";

const TEMPLATE_PATH = resolve(
  __dirname,
  "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx",
);

let tpl: TemplateData;
beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(TEMPLATE_PATH));
});

// 注: 表紙スライドを置かないのは、template-less legacy 経路の既知の癖（index 0 の
// タイトルのみスライドが Title 名前空間読み出しで空になる #144 系）を避け、本 issue の
// 対象（section/toc の往復・導出）だけを検証するため。
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

// ── parse ──

describe("parseMd — <!-- section --> / <!-- toc --> (#151)", () => {
  it("section タグ付きスライドは sectionBreak=true で、タグは本文に残らない", () => {
    const deck = parseMd(MD);
    expect(deck.slides).toHaveLength(4);
    const cover = deck.slides[1];
    expect(cover.sectionBreak).toBe(true);
    const allText = JSON.stringify(cover.placeholders);
    expect(allText).toContain("現状分析");
    expect(allText).not.toContain("section");
    expect(deck.slides[3].sectionBreak).toBe(true);
    // タグ無しスライドはフラグ自体を持たない
    expect(deck.slides[0].sectionBreak).toBeUndefined();
    expect(deck.slides[2].sectionBreak).toBeUndefined();
  });

  it("<!-- toc --> のみのブロックは derived='toc' の派生スライド（内容は持たない）", () => {
    const toc = parseMd(MD).slides[0];
    expect(toc.derived).toBe("toc");
    expect(toc.placeholders).toEqual([]);
  });

  it("section タグはレイアウトピンと併用できる（タグが先でもピンが効く）", () => {
    const md = `<!-- section -->
<!-- slide: Section.1Title.Single -->
# 第 1 部`;
    const s = parseMd(md).slides[0];
    expect(s.sectionBreak).toBe(true);
    expect(s.layout).toBe("Section.1Title.Single");
  });

  it("フェンス内の <!-- section --> / <!-- toc --> 風文字列はコードのまま", () => {
    const md = "# T\n\n```html\n<!-- section -->\n<!-- toc -->\n```";
    const s = parseMd(md).slides[0];
    expect(s.sectionBreak).toBeUndefined();
    expect(s.derived).toBeUndefined();
    expect(s.code?.content).toBe("<!-- section -->\n<!-- toc -->");
  });
});

// ── 導出（採番・目次・再導出） ──

describe("deck-sections — 章スキャン＋採番＋目次導出 (#151)", () => {
  it("scanSections が出現順に採番して章タイトルを返す", () => {
    const sections = scanSections(parseMd(MD));
    expect(sections.map((s) => ({ number: s.number, title: s.title }))).toEqual([
      { number: 1, title: "現状分析" },
      { number: 2, title: "解決策" },
    ]);
    expect(sections.map((s) => s.slideIndex)).toEqual([1, 3]);
  });

  it("materializeDerivedSlides が目次スライドに採番付き章一覧を埋める", () => {
    const deck = materializeDerivedSlides(parseMd(MD));
    const toc = deck.slides[0];
    const body = toc.placeholders.find((p) => p.idx === "1");
    expect(body?.paragraphs.map((p) => p.segments.map((s) => s.text).join(""))).toEqual([
      "1. 現状分析",
      "2. 解決策",
    ]);
  });

  it("章名（# 見出し）の変更が再導出で目次に自動反映される", () => {
    const deck = parseMd(MD);
    // 章扉のタイトルを書き換え（GUI 編集相当）
    const renamed: DeckIR = {
      ...deck,
      slides: deck.slides.map((s, i) =>
        i === 1
          ? {
              ...s,
              placeholders: s.placeholders.map((p) =>
                p.idx === "15" ? { ...p, paragraphs: [{ segments: [{ text: "現状と課題" }] }] } : p,
              ),
            }
          : s,
      ),
    };
    const toc = materializeDerivedSlides(renamed).slides[0];
    const body = toc.placeholders.find((p) => p.idx === "1");
    expect(body?.paragraphs[0].segments[0].text).toBe("1. 現状と課題");
  });

  it("派生スライドが無いデッキは同一参照のまま（新コードパスに入らない）", () => {
    const deck = parseMd("# T\n\n- a");
    expect(materializeDerivedSlides(deck)).toBe(deck);
  });

  it("tocParagraphs は空の章一覧で空配列（0 章＋toc でも落ちない）", () => {
    expect(tocParagraphs([])).toEqual([]);
    const deck = materializeDerivedSlides(parseMd("<!-- toc -->"));
    expect(deck.slides[0].derived).toBe("toc");
  });
});

// ── round-trip ──

describe("serializeMd — section/toc の往復 (#151)", () => {
  it("タグ・マーカーが復元され、再 parse で意味等価", () => {
    const round = serializeMd(parseMd(MD));
    expect(round).toContain("<!-- toc -->");
    expect((round.match(/<!-- section -->/g) ?? []).length).toBe(2);
    const again = parseMd(round);
    expect(again.slides[0].derived).toBe("toc");
    expect(again.slides[1].sectionBreak).toBe(true);
    expect(again.slides[3].sectionBreak).toBe(true);
  });

  it("materialize 済みデッキでも目次は <!-- toc --> の 1 行のみに畳まれる（内容を書き戻さない）", () => {
    const round = serializeMd(materializeDerivedSlides(parseMd(MD)));
    expect(round).toContain("<!-- toc -->");
    expect(round).not.toContain("1. 現状分析"); // 導出内容は Markdown に漏れない
    expect(round).not.toContain("目次"); // 派生タイトルも漏れない
  });

  it("宣言なし md の出力に section/toc マーカーは現れない", () => {
    const round = serializeMd(parseMd("# T\n\n- 本文"));
    expect(round).not.toContain("<!-- section -->");
    expect(round).not.toContain("<!-- toc -->");
  });
});

// ── PPTX（消費点で導出が効く） ──

describe("generatePptx — 目次スライドの導出内容が出力される (#151)", () => {
  it("2 章＋toc のデッキ → 目次スライドの XML に採番付き章一覧が入る", async () => {
    const buf = await generatePptx(parseMd(MD), tpl);
    const zip = await JSZip.loadAsync(buf);
    let all = "";
    for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
      all += await zip.files[name].async("string");
    }
    expect(all).toContain("1. 現状分析");
    expect(all).toContain("2. 解決策");
  });
});
