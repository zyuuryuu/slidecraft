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
  "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx",
);

let tpl: TemplateData;

beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(TEMPLATE_PATH));
});

// ── md-to-ooxml unit tests ──

describe("md-to-ooxml", () => {
  it("converts plain text paragraph", () => {
    const xml = paragraphToOoxml({
      segments: [{ text: "Hello" }],
    });
    expect(xml).toBe("<a:p><a:r><a:t>Hello</a:t></a:r></a:p>");
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

  it("converts bullet paragraph", () => {
    const xml = paragraphToOoxml({
      segments: [{ text: "Item" }],
      bullet: true,
    });
    expect(xml).toContain("a:buChar");
    expect(xml).toContain("Item");
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
