/**
 * md-serializer.test.ts — Tests for SlideIR[] → Markdown serialization.
 *
 * Round-trip: parseMd(serializeMd(parseMd(md))) should produce
 * equivalent SlideIR[] to parseMd(md).
 */

import { describe, it, expect } from "vitest";
import { serializeMd } from "../src/engine/md-serializer";
import { parseMd } from "../src/engine/md-parser";
import { autoSelectLayout } from "../src/engine/template-loader";
import type { DeckIR } from "../src/engine/slide-schema";

describe("text + figure COEXISTENCE round-trips (stage ①)", () => {
  const bullets = (txts: string[]) => txts.map((t) => ({ segments: [{ text: t }], bullet: true }));
  const rt = (deck: DeckIR) => parseMd(serializeMd(deck)).slides[0];

  it("bullets (col 1) + diagram (col 2) survive together", () => {
    const back = rt({ slides: [{
      layout: "Column.2Body.Equal",
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "構成" }] }] },
        { idx: "1", paragraphs: bullets(["要点A", "要点B"]) },
      ],
      diagram: { yaml: "type: flowchart\nnodes:\n  - id: A\n    label: 入力\nedges: []", placeholderIdx: "2" },
    }] });
    expect(back.diagram?.placeholderIdx).toBe("2");
    expect(back.diagram?.yaml).toContain("flowchart");
    const body = back.placeholders.find((p) => p.idx === "1");
    expect(body?.paragraphs).toHaveLength(2); // no spurious empty paragraph
    expect(back.placeholders.find((p) => p.idx === "15")?.paragraphs[0].segments[0].text).toBe("構成");
  });

  it("diagram (col 1) + bullets (col 2) keep their columns", () => {
    const back = rt({ slides: [{
      layout: "Column.2Body.Equal",
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
        { idx: "2", paragraphs: bullets(["右の説明"]) },
      ],
      diagram: { yaml: "type: flowchart\nnodes: []\nedges: []", placeholderIdx: "1" },
    }] });
    expect(back.diagram?.placeholderIdx).toBe("1");
    expect(back.placeholders.find((p) => p.idx === "2")?.paragraphs[0].segments[0].text).toBe("右の説明");
  });

  it("mermaid coexists with bullets", () => {
    const back = rt({ slides: [{
      layout: "Column.2Body.Equal",
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
        { idx: "1", paragraphs: bullets(["x"]) },
      ],
      mermaidBlock: { mermaid: "graph LR\n A-->B", placeholderIdx: "2" },
    }] });
    expect(back.mermaidBlock?.placeholderIdx).toBe("2");
    expect(back.mermaidBlock?.mermaid).toContain("A-->B");
    expect(back.placeholders.find((p) => p.idx === "1")?.paragraphs).toHaveLength(1);
  });

  it("a pure 2-column text slide still round-trips (no figure, no empty paragraphs)", () => {
    const back = rt({ slides: [{
      layout: "Column.2Body.Equal",
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
        { idx: "1", paragraphs: bullets(["L"]) },
        { idx: "2", paragraphs: bullets(["R"]) },
      ],
    }] });
    expect(back.diagram).toBeUndefined();
    expect(back.placeholders.find((p) => p.idx === "1")?.paragraphs).toHaveLength(1);
    expect(back.placeholders.find((p) => p.idx === "2")?.paragraphs[0].segments[0].text).toBe("R");
  });

  it("a solo diagram (single body) still round-trips", () => {
    const back = rt({ slides: [{
      layout: "Content.1Body.Single",
      placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] }],
      diagram: { yaml: "type: flowchart\nnodes: []\nedges: []", placeholderIdx: "1" },
    }] });
    expect(back.diagram?.placeholderIdx).toBe("1");
  });

  it("a figure whose body contains a '---' line is NOT torn into extra slides", () => {
    // YAML doc markers / Mermaid frontmatter contain '---'; the slide splitter must
    // be fence-aware so it doesn't mistake them for a slide separator.
    const deck = {
      slides: [{
        layout: "Content.1Body.Single",
        placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "図" }] }] }],
        diagram: { yaml: "type: flowchart\n---\nnodes:\n  - id: a\n    label: A\nedges: []", placeholderIdx: "1" },
      }],
    };
    const out = parseMd(serializeMd(deck));
    expect(out.slides).toHaveLength(1); // not split mid-fence
    expect(out.slides[0].diagram?.yaml).toContain("---");
    expect(out.slides[0].diagram?.yaml).toContain("nodes:");
  });

  it("a Mermaid block with '---title---' frontmatter round-trips intact", () => {
    const deck = {
      slides: [{
        layout: "Content.1Body.Single",
        placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "M" }] }] }],
        mermaidBlock: { mermaid: "---\ntitle: My Graph\n---\ngraph TD\n A-->B", placeholderIdx: "1" },
      }],
    };
    const out = parseMd(serializeMd(deck));
    expect(out.slides).toHaveLength(1);
    expect(out.slides[0].mermaidBlock?.mermaid).toContain("title: My Graph");
    expect(out.slides[0].mermaidBlock?.mermaid).toContain("graph TD");
  });
});

describe("single-slide serialization (per-slide editing / AI context)", () => {
  it("a lone content slide keeps content format when its resolved layout is set", () => {
    const deck = parseMd("# First\n\n---\n\n# 見出し\n> サブ\n\n- A\n- B\n");
    const content = deck.slides[1];
    expect(content.layout).toBe("auto");
    // App serializes a single slide with its RESOLVED layout so the index-0
    // "first slide → Title" rule doesn't mangle a content slide.
    const resolved = autoSelectLayout(content, 1, deck.slides.length);
    const md = serializeMd({ slides: [{ ...content, layout: resolved }] });
    const rt = parseMd(md).slides[0];
    expect(rt.placeholders.find((p) => p.idx === "15")?.paragraphs[0]?.segments[0]?.text).toBe("見出し");
    expect(rt.placeholders.find((p) => p.idx === "16")).toBeDefined();
    expect(rt.placeholders.find((p) => p.idx === "1")).toBeDefined();
  });

  it("serializing a lone content slide (title+body) at index 0 keeps its content, not Title coercion", () => {
    // Was a documented bug: a content slide serialized alone landed at index 0 and autoSelectLayout
    // coerced it to Title, reading the title through the empty title namespace (idx 0/1) → mangled.
    // Fixed in slideRoleRegions: a title WITH body (idx 15 + idx 1) at index 0 is a content slide, not
    // a cover (which is title-only). See serializer-content-index0.test.ts.
    const deck = parseMd("# First\n\n---\n\n# 見出し\n> サブ\n\n- A\n\n");
    const md = serializeMd({ slides: [deck.slides[1]] });
    expect(md.includes("# 見出し")).toBe(true);
    expect(md.includes("A")).toBe(true); // the body survives too
  });
});

describe("serializeMd", () => {
  // ── Basic serialization ──

  it("serializes a simple content slide", () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "Title" }] }] },
            { idx: "16", paragraphs: [{ segments: [{ text: "Subtitle" }] }] },
            { idx: "1", paragraphs: [{ segments: [{ text: "Body text" }] }] },
          ],
        },
      ],
    };

    const md = serializeMd(deck);
    expect(md).toContain("<!-- slide: Content.1Body.Single -->");
    expect(md).toContain("# Title");
    expect(md).toContain("> Subtitle");
    expect(md).toContain("Body text");
  });

  it("serializes a title slide with fields", () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Title.1Title.Single",
          placeholders: [
            { idx: "0", paragraphs: [{ segments: [{ text: "Main Title" }] }] },
            { idx: "1", paragraphs: [{ segments: [{ text: "Sub" }] }] },
            { idx: "10", paragraphs: [{ segments: [{ text: "REPORT" }] }] },
            { idx: "11", paragraphs: [{ segments: [{ text: "2026-03-31" }] }] },
            { idx: "12", paragraphs: [{ segments: [{ text: "Confidential" }] }] },
          ],
        },
      ],
    };

    const md = serializeMd(deck);
    expect(md).toContain("# Main Title");
    expect(md).toContain("## Sub");
    expect(md).toContain("Category: REPORT");
    expect(md).toContain("Date: 2026-03-31");
    expect(md).toContain("Footer: Confidential");
  });

  it("serializes multiple slides with separators", () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "Slide 1" }] }] },
          ],
        },
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "Slide 2" }] }] },
          ],
        },
      ],
    };

    const md = serializeMd(deck);
    expect(md).toContain("---");
    expect(md.split("---").length).toBe(2); // one separator between two slides
  });

  it("serializes column layout with <!-- col -->", () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Column.2Body.Equal",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "Title" }] }] },
            { idx: "1", paragraphs: [{ segments: [{ text: "Left" }] }] },
            { idx: "2", paragraphs: [{ segments: [{ text: "Right" }] }] },
          ],
        },
      ],
    };

    const md = serializeMd(deck);
    expect(md).toContain("<!-- col -->");
    expect(md).toContain("Left");
    expect(md).toContain("Right");
  });

  it("serializes diagram block", () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "Architecture" }] }] },
          ],
          diagram: {
            yaml: "type: flowchart\nnodes:\n  - id: a\n    label: A",
            placeholderIdx: "1",
          },
        },
      ],
    };

    const md = serializeMd(deck);
    expect(md).toContain("```diagram");
    expect(md).toContain("type: flowchart");
    expect(md).toContain("```");
  });

  it("serializes bold and italic inline formatting", () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "Title" }] }] },
            {
              idx: "1",
              paragraphs: [
                {
                  segments: [
                    { text: "Normal " },
                    { text: "bold", bold: true },
                    { text: " and " },
                    { text: "italic", italic: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const md = serializeMd(deck);
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
  });

  it("serializes bullet lists", () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "Title" }] }] },
            {
              idx: "1",
              paragraphs: [
                { segments: [{ text: "Item A" }], bullet: true },
                { segments: [{ text: "Item B" }], bullet: true },
              ],
            },
          ],
        },
      ],
    };

    const md = serializeMd(deck);
    expect(md).toContain("- Item A");
    expect(md).toContain("- Item B");
  });

  it("includes template in front matter", () => {
    const deck: DeckIR = {
      template: "MyTemplate.pptx",
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
          ],
        },
      ],
    };

    const md = serializeMd(deck);
    expect(md).toContain("---");
    expect(md).toContain("template: MyTemplate.pptx");
  });

  // ── Round-trip ──

  it("round-trips a complex deck", () => {
    const original = `<!-- slide: Title.1Title.Single -->
# Project Report
## Q1 2026

Category: REPORT
Date: 2026-03-31
Footer: Confidential

---

# Agenda
> Today's Agenda

- Item 1
- Item 2
- Item 3

---

<!-- slide: Column.2Body.Equal -->
# Comparison

<!-- col -->
**Option A**

- Pro 1
- Pro 2

<!-- col -->
**Option B**

- Pro 3
- Pro 4`;

    const deck1 = parseMd(original);
    const serialized = serializeMd(deck1);
    const deck2 = parseMd(serialized);

    // Same number of slides
    expect(deck2.slides.length).toBe(deck1.slides.length);

    // Same layouts
    for (let i = 0; i < deck1.slides.length; i++) {
      expect(deck2.slides[i].layout).toBe(deck1.slides[i].layout);
      // Same placeholder count
      expect(deck2.slides[i].placeholders.length).toBe(
        deck1.slides[i].placeholders.length,
      );
    }
  });

  it("preserves body text on a title slide that also has a subtitle (no duplicate idx 1)", () => {
    const md = "<!-- slide: Title.1Title.Single -->\n# 表紙\n## サブ\n\n本文A\n本文B";
    const d1 = parseMd(md);
    // the body must NOT create a second idx-1 placeholder (which the serializer drops)
    expect(d1.slides[0].placeholders.filter((p) => p.idx === "1")).toHaveLength(1);
    const d2 = parseMd(serializeMd(d1));
    const txt = JSON.stringify(d2);
    expect(txt).toContain("本文A");
    expect(txt).toContain("本文B");
  });

  it("does not drop or mislabel Meta when Date is also present (no idx-11 collision)", () => {
    const md = "<!-- slide: Title.1Title.Single -->\n# T\n\nDate: 2026-06-25\nMeta: 補足情報";
    const d2 = parseMd(serializeMd(parseMd(md)));
    const txt = JSON.stringify(d2);
    expect(txt).toContain("2026-06-25"); // Date survives
    expect(txt).toContain("補足情報"); // Meta survives (as body, no longer colliding with Date)
  });
});

// Slice 0 of the AI-quality theme: a single-body FIGURE (table / diagram / mermaid / code) must
// round-trip regardless of the slide's RESOLVED layout. The single-body emitter was gated inside the
// content-layout `else` branch, so a table/code slide PINNED to a Title/Closing or a Column/KPI/Process
// layout (a mis-pin, or the AI editing the header) serialized to nothing — a silent data loss that also
// blinds the AI to the figure it must preserve. Fixed by emitting the figure block in every branch.
describe("single-body figure survives serialize round-trip on any resolved layout (slice 0)", () => {
  const rtLayout = (md: string, layout: string) => {
    const s = parseMd(md).slides[0];
    return parseMd(serializeMd({ slides: [{ ...s, layout }] })).slides[0];
  };

  it("code block survives on a Title layout (was dropped)", () => {
    const back = rtLayout("# コード例\n\n```ts\nconst x = 1;\n```", "Title.1Title.Single");
    expect(back.code?.content).toContain("const x = 1;");
    expect(back.code?.lang).toBe("ts");
  });

  it("code block survives on a Closing layout", () => {
    const back = rtLayout("# ログ\n\n```\nERROR: boom\n```", "Closing.1Message.Single");
    expect(back.code?.content).toContain("ERROR: boom");
  });

  it("table survives on a KPI (separator) layout (was dropped)", () => {
    const back = rtLayout("# 価格\n\n| 項目 | 値 |\n|---|---|\n| A | 100 |", "KPI.3Value.Equal");
    expect(back.table?.rows).toEqual([["項目", "値"], ["A", "100"]]);
  });

  it("table survives on a Title layout", () => {
    const back = rtLayout("# 価格\n\n| 項目 | 値 |\n|---|---|\n| A | 100 |", "Title.1Title.Single");
    expect(back.table?.rows).toEqual([["項目", "値"], ["A", "100"]]);
  });

  it("diagram survives on a Title layout", () => {
    const back = rtLayout(
      "# 構成図\n\n```diagram\ntype: flowchart\nnodes:\n  - id: A\n    label: 入力\nedges: []\n```",
      "Title.1Title.Single",
    );
    expect(back.diagram?.yaml).toContain("flowchart");
  });

  it("still round-trips on the normal single-body content layout (no regression)", () => {
    const back = rtLayout("# コード例\n\n```ts\nconst x = 1;\n```", "Content.1Body.Single");
    expect(back.code?.content).toContain("const x = 1;");
  });
});
