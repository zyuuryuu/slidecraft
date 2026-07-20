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
import {
  scanSections,
  tocParagraphs,
  tocTitleFor,
  sectionNavParagraphs,
  materializeDerivedSlides,
  buildLiveTocSlide,
  buildStaticTocSlide,
  SECTION_NAV_LIST_LAYOUT,
} from "../src/engine/deck-sections";
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

// ── 目次タイトルの文字種切替 (#184) ──

const MD_EN = `<!-- toc -->

---

<!-- section -->
# Overview

---

# Details

- content

---

<!-- section -->
# Proposal
`;

describe("tocTitleFor — 章タイトルの文字種で目次見出しを切替 (#184)", () => {
  it("章タイトルが CJK を含む（日本語）なら「目次」", () => {
    expect(tocTitleFor(scanSections(parseMd(MD)))).toBe("目次");
  });

  it("章タイトルが CJK を含まない（英語のみ）なら Table of Contents", () => {
    expect(tocTitleFor(scanSections(parseMd(MD_EN)))).toBe("Table of Contents");
  });

  it("章タイトルが 1 つでも CJK を含めば「目次」（混在は日本語優先）", () => {
    expect(tocTitleFor([{ slideIndex: 0, number: 1, title: "Overview" }, { slideIndex: 1, number: 2, title: "解決策" }])).toBe(
      "目次",
    );
  });

  it("章が無い（0 章 + toc のみ）なら既定で「目次」", () => {
    expect(tocTitleFor([])).toBe("目次");
  });

  it("materializeDerivedSlides — 日本語デッキの目次見出しは「目次」のまま", () => {
    const toc = materializeDerivedSlides(parseMd(MD)).slides[0];
    expect(toc.placeholders.find((p) => p.idx === "15")?.paragraphs[0].segments[0].text).toBe("目次");
  });

  it("materializeDerivedSlides — 英語のみ章タイトルのデッキの目次見出しは Table of Contents", () => {
    const toc = materializeDerivedSlides(parseMd(MD_EN)).slides[0];
    expect(toc.placeholders.find((p) => p.idx === "15")?.paragraphs[0].segments[0].text).toBe(
      "Table of Contents",
    );
  });

  it("md への書き戻しはマーカー 1 行のみ（派生タイトルは漏れない・英語デッキでも不変）", () => {
    const round = serializeMd(materializeDerivedSlides(parseMd(MD_EN)));
    expect(round).toContain("<!-- toc -->");
    expect(round).not.toContain("Table of Contents");
    expect(round).not.toContain("1. Overview");
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

// ── アジェンダ再掲（#167 / ADR-0032 D2 段階3）: 章扉に全章リスト＋現在章強調 ──

const MD3 = `<!-- section -->
# 現状分析

---

# 詳細スライド

- 内容

---

<!-- section -->
# 解決策

---

<!-- section -->
# まとめ
`;

describe("sectionNavParagraphs (#167)", () => {
  it("全章を箇条書きにし、現在章のみ bold", () => {
    const sections = scanSections(parseMd(MD3));
    const paras = sectionNavParagraphs(sections, 2);
    expect(paras.map((p) => p.segments[0].text)).toEqual(["1. 現状分析", "2. 解決策", "3. まとめ"]);
    expect(paras.map((p) => !!p.segments[0].bold)).toEqual([false, true, false]);
  });
});

describe("materializeDerivedSlides — 章扉の全章リスト再掲＋現在章強調 (#167)", () => {
  it("3 章デッキ: 2 番目の章扉に全 3 章のリストが出て 2 番目だけ強調される", () => {
    const deck = materializeDerivedSlides(parseMd(MD3));
    const chapter2 = deck.slides[2]; // slides: [0]現状分析 [1]詳細 [2]解決策 [3]まとめ
    expect(chapter2.sectionBreak).toBe(true);
    expect(chapter2.layout).toBe(SECTION_NAV_LIST_LAYOUT);
    const list = chapter2.placeholders.find((p) => p.idx === "1");
    expect(list?.paragraphs.map((p) => p.segments[0].text)).toEqual(["1. 現状分析", "2. 解決策", "3. まとめ"]);
    expect(list?.paragraphs.map((p) => !!p.segments[0].bold)).toEqual([false, true, false]);
    // 章タイトル自体（idx 15）は既存のまま
    expect(chapter2.placeholders.find((p) => p.idx === "15")?.paragraphs[0].segments[0].text).toBe("解決策");
  });

  it("章名（# 見出し）の変更が全章扉の再掲に反映される", () => {
    const deck = parseMd(MD3);
    const renamed: DeckIR = {
      ...deck,
      slides: deck.slides.map((s, i) =>
        i === 0
          ? {
              ...s,
              placeholders: s.placeholders.map((p) =>
                p.idx === "15" ? { ...p, paragraphs: [{ segments: [{ text: "現状と課題" }] }] } : p,
              ),
            }
          : s,
      ),
    };
    const materialized = materializeDerivedSlides(renamed);
    for (const idx of [0, 2, 3]) {
      const list = materialized.slides[idx].placeholders.find((p) => p.idx === "1");
      expect(list?.paragraphs[0].segments[0].text).toBe("1. 現状と課題");
    }
  });

  it("section タグが無いデッキは同一参照のまま", () => {
    const deck = parseMd("# T\n\n- a");
    expect(materializeDerivedSlides(deck)).toBe(deck);
  });

  it("layout がピン済みの章扉は上書きしない（レイアウトも再掲も追加しない）", () => {
    const md = `<!-- section -->\n<!-- slide: Section.1Title.Single -->\n# 第 1 部\n\n---\n\n<!-- section -->\n# 第 2 部\n`;
    const deck = materializeDerivedSlides(parseMd(md));
    const first = deck.slides[0];
    expect(first.layout).toBe("Section.1Title.Single"); // ピンは尊重
    expect(first.placeholders.some((p) => p.idx === "1")).toBe(false); // 再掲は注入しない
  });

  it("既に本文（idx 1）を持つ章扉は上書きしない（no-silent-drop: 著者コンテンツを保護）", () => {
    const md = `<!-- section -->\n# 第 1 部\n\n- 既存の本文\n\n---\n\n<!-- section -->\n# 第 2 部\n`;
    const deck = materializeDerivedSlides(parseMd(md));
    const first = deck.slides[0];
    // 既存の layout・本文がそのまま（強制ピンも再掲上書きもしない）
    const body = first.placeholders.find((p) => p.idx === "1");
    expect(body?.paragraphs[0].segments[0].text).toBe("既存の本文");
  });

  it("元の deck オブジェクトは変更しない（materialize は非破壊）", () => {
    const deck = parseMd(MD3);
    const before = JSON.stringify(deck);
    materializeDerivedSlides(deck);
    expect(JSON.stringify(deck)).toBe(before);
  });
});

describe("serializeMd — 章扉の再掲は md に漏れない (#167)", () => {
  it("宣言（元 deck）の往復には再掲リストが一切現れない", () => {
    const round = serializeMd(parseMd(MD3));
    expect(round).not.toContain("1. 現状分析");
    expect(round).not.toContain("2. 解決策");
    expect((round.match(/<!-- section -->/g) ?? []).length).toBe(3);
  });

  it("materialize 済みデッキでも再掲は <!-- section --> タグ＋タイトルのみに畳まれる（内容を書き戻さない）", () => {
    const round = serializeMd(materializeDerivedSlides(parseMd(MD3)));
    expect(round).not.toContain("1. 現状分析");
    expect(round).not.toContain("2. 解決策");
    expect(round).not.toContain(SECTION_NAV_LIST_LAYOUT);
    expect((round.match(/<!-- section -->/g) ?? []).length).toBe(3);
  });

  it("著者が SectionNav.1TitleList.Single を明示ピンし自分で本文を書いた章扉は、fold の対象外（no-silent-drop）", () => {
    // レビュー指摘の repro: layout 名の一致だけで fold すると、著者の pin と自書き本文が全損する。
    const md = `<!-- section -->\n<!-- slide: ${SECTION_NAV_LIST_LAYOUT} -->\n# 第 1 部\n\n- 著者自身の本文\n`;
    const round = serializeMd(parseMd(md));
    expect(round).toContain(`<!-- slide: ${SECTION_NAV_LIST_LAYOUT} -->`);
    expect(round).toContain("著者自身の本文");
  });
});

describe("generatePptx — 章扉の全章リスト再掲が PPTX に出力される (#167)", () => {
  it("3 章デッキ → 2 番目の章扉のスライド XML に全章＋強調（bold run）が入る", async () => {
    const buf = await generatePptx(parseMd(MD3), tpl);
    const zip = await JSZip.loadAsync(buf);
    const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    let chapter2Xml = "";
    for (const name of slideFiles) {
      const xml = await zip.files[name].async("string");
      // the slide whose TITLE (bare, no "N. " prefix) is "解決策" — not just any slide whose recap
      // list happens to mention it (every chapter's recap lists all chapter names).
      if (xml.includes("<a:t>解決策</a:t>")) chapter2Xml = xml;
    }
    expect(chapter2Xml).toContain("1. 現状分析");
    expect(chapter2Xml).toContain("2. 解決策");
    expect(chapter2Xml).toContain("3. まとめ");
    // 現在章（2. 解決策）の run だけ bold・他章は bold なし
    expect(chapter2Xml).toContain('<a:r><a:rPr b="1"/><a:t>2. 解決策</a:t></a:r>');
    expect(chapter2Xml).toContain("<a:r><a:t>1. 現状分析</a:t></a:r>");
    expect(chapter2Xml).toContain("<a:r><a:t>3. まとめ</a:t></a:r>");
  });
});

// ── GUI「便利スライドを生成」— 目次 live/static (ADR-0034 / #277) ──

describe("buildLiveTocSlide (#277)", () => {
  it("derived='toc' の空スライドを返す（内容は消費点で導出、直接編集不可）", () => {
    expect(buildLiveTocSlide()).toEqual({ layout: "auto", placeholders: [], derived: "toc" });
  });

  it("挿入後、章名を変えると目次が追随する（materializeDerivedSlides 経由）", () => {
    const deck: DeckIR = {
      slides: [
        { layout: "auto", placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "第1章" }] }] }], sectionBreak: true },
        buildLiveTocSlide(),
      ],
    };
    const before = materializeDerivedSlides(deck).slides[1].placeholders.find((p) => p.idx === "1");
    expect(before?.paragraphs[0].segments[0].text).toBe("1. 第1章");

    const renamed: DeckIR = {
      ...deck,
      slides: deck.slides.map((s, i) =>
        i === 0 ? { ...s, placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "改題後" }] }] }] } : s,
      ),
    };
    const after = materializeDerivedSlides(renamed).slides[1].placeholders.find((p) => p.idx === "1");
    expect(after?.paragraphs[0].segments[0].text).toBe("1. 改題後");
  });

  it("直接編集できない（placeholders を差し替えても derived='toc' の限り再導出で上書きされる）", () => {
    const deck: DeckIR = {
      slides: [
        { layout: "auto", placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "第1章" }] }] }], sectionBreak: true },
        { ...buildLiveTocSlide(), placeholders: [{ idx: "1", paragraphs: [{ segments: [{ text: "手書きの割り込み" }] }] }] },
      ],
    };
    const materialized = materializeDerivedSlides(deck).slides[1].placeholders.find((p) => p.idx === "1");
    expect(materialized?.paragraphs[0].segments[0].text).toBe("1. 第1章"); // 手書き分は再導出で消える
  });
});

describe("buildStaticTocSlide (#277)", () => {
  it("普通の編集可能スライドを返す（derived 無し・現在の章から1回生成）", () => {
    const slide = buildStaticTocSlide(parseMd(MD));
    expect(slide.derived).toBeUndefined();
    expect(slide.layout).toBe("auto");
    const body = slide.placeholders.find((p) => p.idx === "1");
    expect(body?.paragraphs.map((p) => p.segments[0].text)).toEqual(["1. 現状分析", "2. 解決策"]);
    expect(slide.placeholders.find((p) => p.idx === "15")?.paragraphs[0].segments[0].text).toBe("目次");
  });

  it("live/static とも tocParagraphs/scanSections の同じ導出結果を使う（単一経路・R8）", () => {
    const deck = parseMd(MD);
    const staticSlide = buildStaticTocSlide(deck);
    const liveSlide = materializeDerivedSlides({ ...deck, slides: [...deck.slides, buildLiveTocSlide()] }).slides.at(-1)!;
    expect(staticSlide.placeholders.find((p) => p.idx === "1")).toEqual(liveSlide.placeholders.find((p) => p.idx === "1"));
    expect(staticSlide.placeholders.find((p) => p.idx === "15")).toEqual(liveSlide.placeholders.find((p) => p.idx === "15"));
  });

  it("生成後は普通に編集でき、章を変えても追随しない（固定）— 生成時点のスナップショット", () => {
    const deck = parseMd(MD);
    const generated = buildStaticTocSlide(deck);
    const deckWithStaticToc: DeckIR = { ...deck, slides: [...deck.slides, generated] };
    // 著者が普通に編集（1行追記）
    const edited: DeckIR = {
      ...deckWithStaticToc,
      slides: deckWithStaticToc.slides.map((s, i) =>
        i === deckWithStaticToc.slides.length - 1
          ? { ...s, placeholders: s.placeholders.map((p) => (p.idx === "1" ? { ...p, paragraphs: [...p.paragraphs, { segments: [{ text: "補足" }], bullet: true }] } : p)) }
          : s,
      ),
    };
    // 章名を変更しても static スライドは materialize の対象外＝そのまま
    const renamed: DeckIR = {
      ...edited,
      slides: edited.slides.map((s, i) =>
        i === 1 ? { ...s, placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "改題後" }] }] }] } : s,
      ),
    };
    const staticAfter = materializeDerivedSlides(renamed).slides.at(-1)!;
    const body = staticAfter.placeholders.find((p) => p.idx === "1");
    expect(body?.paragraphs.map((p) => p.segments[0].text)).toEqual(["1. 現状分析", "2. 解決策", "補足"]); // 編集は残る・章名変更に追随しない
  });

  it("作り直す＝buildStaticTocSlide を現在の deck で再度呼ぶだけ（明示再生成、単一経路）", () => {
    const deck = parseMd(MD);
    const renamed: DeckIR = {
      ...deck,
      slides: deck.slides.map((s, i) =>
        i === 1 ? { ...s, placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "改題後" }] }] }] } : s,
      ),
    };
    const recreated = buildStaticTocSlide(renamed);
    const body = recreated.placeholders.find((p) => p.idx === "1");
    expect(body?.paragraphs.map((p) => p.segments[0].text)).toEqual(["1. 改題後", "2. 解決策"]);
  });

  it("章が無いデッキでも落ちない（idx1 は注入しない）", () => {
    const slide = buildStaticTocSlide({ slides: [{ layout: "auto", placeholders: [] }] });
    expect(slide.placeholders.some((p) => p.idx === "1")).toBe(false);
    expect(slide.placeholders.find((p) => p.idx === "15")?.paragraphs[0].segments[0].text).toBe("目次");
  });
});

describe("serializeMd — static 目次は普通のスライドとして往復する (#277)", () => {
  it("<!-- toc --> マーカーに畳まれず、見出し＋箇条書きとして書き戻る", () => {
    const deck = parseMd(MD);
    const withStatic: DeckIR = { ...deck, slides: [...deck.slides, buildStaticTocSlide(deck)] };
    const round = serializeMd(withStatic);
    expect(round).toContain("1. 現状分析");
    expect(round).toContain("2. 解決策");
    const again = parseMd(round);
    expect(again.slides.at(-1)?.derived).toBeUndefined();
  });
});
