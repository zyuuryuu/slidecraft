/**
 * speaker-notes.test.ts — #150 / ADR-0032 D1: `<!-- note -->` スピーカーノート記法の受け入れ基準。
 *
 * - parse: マーカー以降〜スライド末尾（次の `---`）が `SlideIR.notes`（Paragraph[]）に入る
 * - round-trip: serializeMd が `<!-- note -->` ＋本文を復元し、再 parse で意味等価
 * - PPTX: notes 付きスライドに notesSlide パート（＋rels / notesMaster / [Content_Types] /
 *   presentation.xml の notesMasterIdLst）が生成され、ノート文字列を含む
 * - 不変条件: notes が空のスライド／デッキには notesSlide パートを一切生成しない（ADR-0032:
 *   「ノート無しデッキの出力不変を構造的に担保」）
 * - distill 分割: ノートは先頭チャンクのみに残す（複製しない）
 * - HTML shell: notes 付きはパネル＋'n' トグルを持ち、notes 無しの出力は byte-identical
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { generatePptx } from "../src/engine/placeholder-filler";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { splitSlideToFit } from "../src/engine/distill";
import { assembleHtmlDeck } from "../src/engine/html-shell";
import type { SlideIR, Paragraph } from "../src/engine/slide-schema";

const TEMPLATE_PATH = resolve(
  __dirname,
  "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx",
);

let tpl: TemplateData;
beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(TEMPLATE_PATH));
});

/** notes（Paragraph[]）をプレーンテキスト行へ（segments 連結）。 */
function noteTexts(slide: SlideIR): string[] {
  return (slide.notes ?? []).map((p: Paragraph) => p.segments.map((s) => s.text).join(""));
}

// ── parse ──

describe("parseMd — <!-- note --> スピーカーノート (#150)", () => {
  it("マーカー以降スライド末尾までが notes に入り、本文からは消える", () => {
    const md = `# タイトル

- 表に出す要点

<!-- note -->
ここから発表者ノート。
- 補足の箇条書き
複数行も可。`;
    const s = parseMd(md).slides[0];
    const body = s.placeholders.find((p) => p.idx === "1");
    expect(body?.paragraphs.map((p) => p.segments.map((x) => x.text).join(""))).toEqual([
      "表に出す要点",
    ]);
    expect(noteTexts(s)).toEqual(["ここから発表者ノート。", "補足の箇条書き", "複数行も可。"]);
    expect(s.notes![1].bullet).toBe(true);
  });

  it("notes は次の --- で止まる（次スライドへ漏れない）", () => {
    const md = `# S1

- A

<!-- note -->
S1 のノート

---

# S2

- B`;
    const [s1, s2] = parseMd(md).slides;
    expect(noteTexts(s1)).toEqual(["S1 のノート"]);
    expect(s2.notes).toBeUndefined();
    expect(noteTexts(s2)).toEqual([]);
  });

  it("グループ（col）スライドでも末尾の notes を消費する", () => {
    const md = `# 比較

<!-- col -->
- 左

<!-- col -->
- 右

<!-- note -->
両案のトレードオフを口頭で補足。`;
    const s = parseMd(md).slides[0];
    expect(s.placeholders.find((p) => p.idx === "1")).toBeTruthy();
    expect(s.placeholders.find((p) => p.idx === "2")).toBeTruthy();
    expect(noteTexts(s)).toEqual(["両案のトレードオフを口頭で補足。"]);
  });

  it("``` フェンス内の <!-- note --> 風文字列はコードのまま（ノート化しない）", () => {
    const md = "# T\n\n```html\n<!-- note -->\n<div>ok</div>\n```";
    const s = parseMd(md).slides[0];
    expect(s.code?.content).toBe("<!-- note -->\n<div>ok</div>");
    expect(s.notes).toBeUndefined();
  });

  it("ノート無しスライドの notes は undefined（新コードパスに入らない）", () => {
    const s = parseMd("# T\n\n- 本文").slides[0];
    expect(s.notes).toBeUndefined();
  });
});

// ── round-trip ──

describe("serializeMd — notes の往復 (#150)", () => {
  it("<!-- note --> とノート本文が復元され、再 parse で意味等価", () => {
    const md = `# タイトル

- 要点

<!-- note -->
発表者向けの**詳細**な補足。
- 論点1
- 論点2`;
    const round = serializeMd(parseMd(md));
    expect(round).toContain("<!-- note -->");
    expect(round).toContain("発表者向けの**詳細**な補足。");
    const again = parseMd(round).slides[0];
    expect(again.notes).toEqual(parseMd(md).slides[0].notes);
  });

  it("ノート無しデッキの出力に <!-- note --> は現れない", () => {
    const round = serializeMd(parseMd("# T\n\n- 本文"));
    expect(round).not.toContain("<!-- note -->");
  });
});

// ── PPTX ──

describe("generatePptx — notesSlide パート (#150)", () => {
  const notesDeck = () => {
    const deck = parseMd(`# 表紙

- 要点

<!-- note -->
これはスライド1のスピーカーノートです。

---

# 2枚目

- ノート無し`);
    return deck;
  };

  it("notes 付きスライドに notesSlide パートが生成されノート文字列を含む", async () => {
    const buf = await generatePptx(notesDeck(), tpl);
    const zip = await JSZip.loadAsync(buf);
    const notesXml = await zip.file("ppt/notesSlides/notesSlide1.xml")?.async("string");
    expect(notesXml).toBeTruthy();
    expect(notesXml).toContain("これはスライド1のスピーカーノートです。");
  });

  it("notesSlide の rels がスライドと notesMaster を参照し、スライド rels が notesSlide を参照する", async () => {
    const buf = await generatePptx(notesDeck(), tpl);
    const zip = await JSZip.loadAsync(buf);
    const notesRels = await zip.file("ppt/notesSlides/_rels/notesSlide1.xml.rels")?.async("string");
    expect(notesRels).toContain("relationships/notesMaster");
    expect(notesRels).toContain("../slides/slide1.xml");
    const slideRels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(slideRels).toContain("relationships/notesSlide");
    expect(slideRels).toContain("../notesSlides/notesSlide1.xml");
  });

  it("notesMaster パート＋presentation.xml の notesMasterIdLst＋Content_Types が揃う", async () => {
    const buf = await generatePptx(notesDeck(), tpl);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file("ppt/notesMasters/notesMaster1.xml")).toBeTruthy();
    const presXml = await zip.file("ppt/presentation.xml")!.async("string");
    expect(presXml).toContain("<p:notesMasterIdLst>");
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain("/ppt/notesSlides/notesSlide1.xml");
    expect(ct).toContain("notesSlide+xml");
    expect(ct).toContain("notesMaster+xml");
  });

  it("notes が空のスライドには notesSlide パートを生成しない（デッキ内共存）", async () => {
    const buf = await generatePptx(notesDeck(), tpl);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file("ppt/notesSlides/notesSlide2.xml")).toBeNull();
    const slideRels2 = await zip.file("ppt/slides/_rels/slide2.xml.rels")!.async("string");
    expect(slideRels2).not.toContain("notesSlide");
  });

  it("ノート無しデッキには notesSlides / notesMaster を一切生成しない（出力不変の構造担保）", async () => {
    const deck = parseMd("# T\n\n- 本文");
    const buf = await generatePptx(deck, tpl);
    const zip = await JSZip.loadAsync(buf);
    const notesParts = Object.keys(zip.files).filter((p) => p.startsWith("ppt/notes"));
    expect(notesParts).toEqual([]);
    const presXml = await zip.file("ppt/presentation.xml")!.async("string");
    expect(presXml).not.toContain("notesMasterIdLst");
  });

  it("notes 関連パートが期待のルート要素を持つ（整形式の入口チェック）", async () => {
    const buf = await generatePptx(notesDeck(), tpl);
    const zip = await JSZip.loadAsync(buf);
    const notesXml = await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
    expect(notesXml).toMatch(/<p:notes[ >]/);
    expect(notesXml).toContain("</p:notes>");
    const masterXml = await zip.file("ppt/notesMasters/notesMaster1.xml")!.async("string");
    expect(masterXml).toMatch(/<p:notesMaster[ >]/);
    expect(masterXml).toContain("</p:notesMaster>");
    for (const name of ["ppt/notesSlides/_rels/notesSlide1.xml.rels", "ppt/notesMasters/_rels/notesMaster1.xml.rels"]) {
      const rels = await zip.file(name)!.async("string");
      expect(rels).toContain("<Relationships");
      expect(rels).toContain("</Relationships>");
    }
  });
});

// ── distill ──

describe("distill — 分割時のノートは先頭チャンクのみ (#150)", () => {
  it("splitSlideToFit で 2 分割 → notes は chunk[0] だけに残る", () => {
    const longBody: Paragraph[] = Array.from({ length: 8 }, (_, i) => ({
      segments: [{ text: `行${i} ` + "あ".repeat(30) }],
      bullet: true,
    }));
    const slide: SlideIR = {
      layout: "auto",
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
        { idx: "1", paragraphs: longBody },
      ],
      notes: [{ segments: [{ text: "分割対象スライドのノート" }] }],
    };
    const parts = splitSlideToFit(slide, { charsPerLine: 20, maxLines: 8 });
    expect(parts.length).toBeGreaterThan(1);
    expect(noteTexts(parts[0])).toEqual(["分割対象スライドのノート"]);
    for (const cont of parts.slice(1)) {
      expect(cont.notes ?? []).toEqual([]);
    }
  });
});

// ── HTML shell ──

describe("assembleHtmlDeck — notes パネル (#150)", () => {
  const opts = { stageW: 1280, stageH: 720 } as const;
  const slides = ["<div>s1</div>", "<div>s2</div>"];

  it("notes 付き: パネル要素・ノート本文・'n' トグルが出力される（既定非表示）", () => {
    const html = assembleHtmlDeck(slides, { ...opts, notes: ["ノート本文1", undefined] });
    expect(html).toContain("notespanel");
    expect(html).toContain("ノート本文1");
    // 'n' キーでトグルするインラインスクリプト（既定は shownotes クラス無し＝非表示）
    expect(html).toMatch(/'n'/);
    expect(html).not.toContain('class="shownotes"');
  });

  it("notes 無し: notes 配列を渡さない出力と空 notes の出力が byte-identical（新コードパス不使用）", () => {
    const base = assembleHtmlDeck(slides, { ...opts });
    const empty = assembleHtmlDeck(slides, { ...opts, notes: [undefined, undefined] });
    expect(empty).toBe(base);
    expect(base).not.toContain("notespanel");
  });
});
