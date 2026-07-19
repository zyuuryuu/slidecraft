/**
 * placeholder-filler.test.ts — Tests for PPTX generation from DeckIR + template.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";
import { parseMd } from "../src/engine/md-parser";
import { paragraphsToOoxml, paragraphToOoxml } from "../src/engine/md-to-ooxml";
import type { DeckIR } from "../src/engine/slide-schema";

const TEMPLATE_PATH = resolve(
  __dirname,
  "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx",
);

let tpl: TemplateData;

beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(TEMPLATE_PATH));
});

// ── md-to-ooxml unit tests ──

describe("md-to-ooxml", () => {
  it("converts plain (non-bullet) text paragraph (bullets suppressed via buNone)", () => {
    const xml = paragraphToOoxml({
      segments: [{ text: "Hello" }],
    });
    expect(xml).toBe("<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>Hello</a:t></a:r></a:p>");
  });

  it("converts bold text", () => {
    const xml = paragraphToOoxml({
      segments: [{ text: "Bold", bold: true }],
    });
    expect(xml).toContain('b="1"');
    expect(xml).toContain("Bold");
  });

  it("converts italic text", () => {
    const xml = paragraphToOoxml({
      segments: [{ text: "Italic", italic: true }],
    });
    expect(xml).toContain('i="1"');
  });

  it("bullet paragraph INHERITS the master's bullet (no forced glyph)", () => {
    const xml = paragraphToOoxml({
      segments: [{ text: "Item" }],
      bullet: true,
    });
    // Master-conformant: we no longer hardcode a buChar — the placeholder/master
    // list style decides the bullet (or none).
    expect(xml).not.toContain("buChar");
    expect(xml).not.toContain("buNone");
    expect(xml).toContain("Item");
  });

  it("non-bullet paragraph suppresses bullets (buNone)", () => {
    const xml = paragraphToOoxml({ segments: [{ text: "Prose" }], bullet: false });
    expect(xml).toContain("buNone");
  });

  it("escapes XML special characters", () => {
    const xml = paragraphToOoxml({
      segments: [{ text: '<script>"&' }],
    });
    expect(xml).toContain("&lt;script&gt;&quot;&amp;");
    expect(xml).not.toContain("<script>");
  });

  it("converts multiple paragraphs", () => {
    const xml = paragraphsToOoxml([
      { segments: [{ text: "Line 1" }] },
      { segments: [{ text: "Line 2" }] },
    ]);
    expect(xml).toContain("Line 1");
    expect(xml).toContain("Line 2");
    expect((xml.match(/<a:p>/g) || []).length).toBe(2);
  });

  // #103: nested bullets → <a:pPr lvl="1..3">. Level 0 (field absent) stays byte-identical with
  // the pre-#103 output above ("bullet paragraph INHERITS the master's bullet" — no pPr at all);
  // PowerPoint resolves lvl 1-3's font/glyph/indent from the master's lvl2pPr..lvl4pPr, same
  // inheritance contract as lvl1 (master-font-inherit.test.ts) — nothing else is pinned here (R7).
  it("#103: level 1/2/3 emit <a:pPr lvl=\"1..3\"/>, nothing else pinned", () => {
    expect(paragraphToOoxml({ segments: [{ text: "Child" }], bullet: true, level: 1 })).toBe(
      '<a:p><a:pPr lvl="1"/><a:r><a:t>Child</a:t></a:r></a:p>',
    );
    expect(paragraphToOoxml({ segments: [{ text: "Grandchild" }], bullet: true, level: 2 })).toBe(
      '<a:p><a:pPr lvl="2"/><a:r><a:t>Grandchild</a:t></a:r></a:p>',
    );
    expect(paragraphToOoxml({ segments: [{ text: "GGC" }], bullet: true, level: 3 })).toBe(
      '<a:p><a:pPr lvl="3"/><a:r><a:t>GGC</a:t></a:r></a:p>',
    );
  });

  it("#103: level 0 (field absent) is byte-identical to a plain bullet paragraph", () => {
    const withLevel0 = paragraphToOoxml({ segments: [{ text: "Item" }], bullet: true, level: 0 });
    const withoutLevel = paragraphToOoxml({ segments: [{ text: "Item" }], bullet: true });
    expect(withLevel0).toBe(withoutLevel);
    expect(withLevel0).not.toContain("pPr");
  });
});

// ── PPTX generation tests ──

describe("generatePptx", () => {
  it("generates a valid PPTX with correct slide count", async () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "Test Title" }] }] },
            { idx: "1", paragraphs: [{ segments: [{ text: "Test Body" }] }] },
          ],
        },
      ],
    };

    const buf = await generatePptx(deck, tpl);
    expect(buf.length).toBeGreaterThan(0);

    // Verify it's a valid ZIP/PPTX
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file("ppt/slides/slide1.xml")).not.toBeNull();
    expect(zip.file("ppt/slides/slide2.xml")).toBeNull();
  });

  it("generates multiple slides", async () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Title.1Title.Single",
          placeholders: [
            { idx: "0", paragraphs: [{ segments: [{ text: "Title" }] }] },
          ],
        },
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "Content" }] }] },
          ],
        },
        {
          layout: "Closing.1Message.Single",
          placeholders: [
            { idx: "0", paragraphs: [{ segments: [{ text: "End" }] }] },
          ],
        },
      ],
    };

    const buf = await generatePptx(deck, tpl);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file("ppt/slides/slide1.xml")).not.toBeNull();
    expect(zip.file("ppt/slides/slide2.xml")).not.toBeNull();
    expect(zip.file("ppt/slides/slide3.xml")).not.toBeNull();
  });

  it("slide XML contains the provided text", async () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "マイタイトル" }] }] },
            {
              idx: "1",
              paragraphs: [{ segments: [{ text: "本文テスト" }] }],
            },
          ],
        },
      ],
    };

    const buf = await generatePptx(deck, tpl);
    const zip = await JSZip.loadAsync(buf);
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("マイタイトル");
    expect(slideXml).toContain("本文テスト");
  });

  it("slide references correct layout in rels", async () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Column.2Body.Equal",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
          ],
        },
      ],
    };

    const buf = await generatePptx(deck, tpl);
    const zip = await JSZip.loadAsync(buf);
    const rels = await zip
      .file("ppt/slides/_rels/slide1.xml.rels")!
      .async("string");
    // Column.2Body.Equal is layout index 11
    expect(rels).toContain("slideLayout11.xml");
  });

  it("updates presentation.xml with slide references", async () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
          ],
        },
      ],
    };

    const buf = await generatePptx(deck, tpl);
    const zip = await JSZip.loadAsync(buf);
    const presXml = await zip
      .file("ppt/presentation.xml")!
      .async("string");
    expect(presXml).toContain("p:sldId");
    expect(presXml).not.toContain("<p:sldIdLst/>");
  });

  it("end-to-end: Markdown → DeckIR → PPTX", async () => {
    const md = `---
template: test.pptx
---

<!-- slide: Title.1Title.Single -->
# プロジェクト報告
## 2026年度 Q1

Category: REPORT
Date: 2026-03-31
Footer: Confidential

---

# 本日の議題
> Agenda

- 進捗報告
- 課題共有
- 次のアクション

---

<!-- slide: Column.2Body.Equal -->
# 比較分析
> Analysis

<!-- col -->
**案 A**: コスト重視
- 低コスト
- 実績あり

<!-- col -->
**案 B**: 品質重視
- 高品質
- 新技術`;

    const deck = parseMd(md);
    expect(deck.slides).toHaveLength(3);

    const buf = await generatePptx(deck, tpl);
    const zip = await JSZip.loadAsync(buf);

    // Verify 3 slides
    expect(zip.file("ppt/slides/slide1.xml")).not.toBeNull();
    expect(zip.file("ppt/slides/slide2.xml")).not.toBeNull();
    expect(zip.file("ppt/slides/slide3.xml")).not.toBeNull();

    // Verify text content
    const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(s1).toContain("プロジェクト報告");

    const s2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(s2).toContain("本日の議題");

    const s3 = await zip.file("ppt/slides/slide3.xml")!.async("string");
    expect(s3).toContain("比較分析");
  });
});

// ── #103: nested bullets, end-to-end through generatePptx ──

describe("generatePptx — nested bullets (#103)", () => {
  const md = `# ネスト箇条書き

- ルート
  - レベル1
    - レベル2
      - レベル3`;

  it("emits lvl=\"1\"/\"2\"/\"3\" for the nested bullets, in document order", async () => {
    const buf = await generatePptx(parseMd(md), tpl);
    const zip = await JSZip.loadAsync(buf);
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const lvls = [...slideXml.matchAll(/<a:pPr lvl="(\d)"\/>/g)].map((m) => m[1]);
    expect(lvls).toEqual(["1", "2", "3"]);
    expect(slideXml).toContain("ルート");
    expect(slideXml).toContain("レベル3");
  });

  it("a flat (unindented) bullet deck's slide XML is byte-identical whether or not #103 shipped", async () => {
    const flatMd = "# タイトル\n\n- 項目A\n- 項目B\n- 項目C";
    const buf = await generatePptx(parseMd(flatMd), tpl);
    const zip = await JSZip.loadAsync(buf);
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).not.toContain("<a:pPr lvl=");
    // Each bullet paragraph is the plain, glyph-inheriting form (no <a:pPr> element at all).
    expect(slideXml).toContain("<a:p><a:r><a:t>項目A</a:t></a:r></a:p>");
  });
});
