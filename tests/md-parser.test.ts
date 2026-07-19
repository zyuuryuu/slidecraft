/**
 * md-parser.test.ts — Tests for Markdown → SlideIR[] parser.
 */

import { describe, it, expect } from "vitest";
import { parseMd, parseMdReport } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";

describe("parseMd — image block", () => {
  const DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  it("parses a standalone ![alt](data-uri) into an image block on body region 1", () => {
    const s = parseMd(`# 図解\n\n![社内フロー](${DATA_URI})`).slides[0];
    expect(s.image).toEqual({ alt: "社内フロー", src: DATA_URI, placeholderIdx: "1" });
    expect(s.placeholders.some((p) => p.idx === "15" || p.idx === "0")).toBe(true); // title still bound
  });
  it("round-trips: image → Markdown → image (src/alt preserved verbatim)", () => {
    const md = `# 図解\n\n![社内フロー](${DATA_URI})`;
    const round = parseMd(serializeMd(parseMd(md))).slides[0];
    expect(round.image).toEqual({ alt: "社内フロー", src: DATA_URI, placeholderIdx: "1" });
  });
  it("a non-data:image src is NOT embedded (M6 security — the line degrades to text, never an <img>)", () => {
    // Was previously src-agnostic; now only a self-contained data:image URI is embedded (isSafeImageSrc)
    // so a relative/remote/javascript src can't reach <img> or the exported HTML.
    expect(parseMd(`# T\n\n![](assets/x.png)`).slides[0].image).toBeUndefined();
  });
});

// #148: a 2nd+ GFM table (or any body content around/after the first table) is completely DROPPED —
// findTableInLines only returns the FIRST table's rows, and the table/body branches are mutually
// exclusive (md-slide-parser.ts), so nothing besides that first table survives into SlideIR. The raw
// dropped lines are gone the moment parseSlideBlock returns, so ONLY the parser can report this —
// deck-diagnostics (which only sees the parsed DeckIR) has nothing left to reconstruct from.
describe("parseMdReport — table-dropped ParseNotice", () => {
  const TABLE_A = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  const TABLE_B = "| c | d |\n| --- | --- |\n| 3 | 4 |";

  it("fires when a 2nd table follows the first (both dropped but the 1st)", () => {
    const { deck, notices } = parseMdReport(`# T\n\n${TABLE_A}\n\n${TABLE_B}`);
    expect(deck.slides[0].table?.rows).toEqual([["a", "b"], ["1", "2"]]); // only the FIRST table survives
    expect(notices).toEqual([{ slideIndex: 0, kind: "table-dropped" }]);
  });

  it("fires when prose surrounds a single table (the prose is dropped too)", () => {
    const { notices } = parseMdReport(`# T\n\n前置き\n\n${TABLE_A}\n\n後書き`);
    expect(notices).toEqual([{ slideIndex: 0, kind: "table-dropped" }]);
  });

  it("does NOT fire for a slide with exactly one table and nothing else in the body", () => {
    const { notices } = parseMdReport(`# T\n\n> サブ\n\n${TABLE_A}`);
    expect(notices).toEqual([]);
  });

  it("does NOT fire for a slide with no table at all", () => {
    const { notices } = parseMdReport(`# T\n\n- a\n- b`);
    expect(notices).toEqual([]);
  });

  it("tags the correct slideIndex across multiple slides", () => {
    const { notices } = parseMdReport(`# 一\n\n- a\n\n---\n\n# 二\n\n${TABLE_A}\n\n${TABLE_B}`);
    expect(notices).toEqual([{ slideIndex: 1, kind: "table-dropped" }]);
  });

  it("parseMd (the thin wrapper) returns the identical deck parseMdReport does", () => {
    const md = `# T\n\n${TABLE_A}\n\n${TABLE_B}`;
    expect(parseMd(md)).toEqual(parseMdReport(md).deck);
  });
});

describe("parseMd", () => {
  // ── Basic structure ──

  it("parses a single content slide", () => {
    const md = `# スライドタイトル
> サブタイトル

本文テキスト`;

    const deck = parseMd(md);
    expect(deck.slides).toHaveLength(1);

    const s = deck.slides[0];
    expect(s.layout).toBe("auto");
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "15" }),
    );
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "16" }),
    );
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "1" }),
    );
  });

  it("splits slides on ---", () => {
    const md = `# Slide 1

Body 1

---

# Slide 2

Body 2`;

    const deck = parseMd(md);
    expect(deck.slides).toHaveLength(2);
  });

  // ── Layout directive ──

  it("respects <!-- slide: --> layout directive", () => {
    const md = `<!-- slide: KPI.3Value.Equal -->
# Metrics
> Key Metrics

<!-- kpi -->
98.5%
Uptime

<!-- kpi -->
$2.4M
Revenue`;

    const deck = parseMd(md);
    expect(deck.slides[0].layout).toBe("KPI.3Value.Equal");
  });

  // ── CRLF normalization (#164) ──
  // Windows 由来の CRLF Markdown で layout pin が無効化され、ディレクティブ行が
  // 本文（idx=1）に印字されてしまう既存バグの回帰テスト。

  it("respects <!-- slide: --> layout directive under CRLF line endings", () => {
    const md = "<!-- slide: Content.X -->\r\n# T\r\n\r\nbody\r\n";
    const deck = parseMd(md);
    expect(deck.slides[0].layout).toBe("Content.X");

    const body1 = deck.slides[0].placeholders.find((p) => p.idx === "1");
    const bodyText = JSON.stringify(body1);
    expect(bodyText).not.toContain("slide:");
    expect(bodyText).not.toContain("-->");
  });

  it("produces byte-identical slides for CRLF vs LF input with a layout directive", () => {
    const lf = "<!-- slide: Content.X -->\n# T\n\nbody\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(parseMd(crlf)).toEqual(parseMd(lf));
  });

  // ── Front matter ──

  it("parses YAML front matter for template", () => {
    const md = `---
template: MyTemplate.pptx
---

# Title`;

    const deck = parseMd(md);
    expect(deck.template).toBe("MyTemplate.pptx");
    expect(deck.slides).toHaveLength(1);
  });

  it("parses YAML front matter under CRLF line endings (#164)", () => {
    const md = "---\r\ntemplate: MyTemplate.pptx\r\n---\r\n\r\n# Title";
    const deck = parseMd(md);
    expect(deck.template).toBe("MyTemplate.pptx");
    expect(deck.slides).toHaveLength(1);
  });

  // ── Title slides ──

  it("parses title slide with Key: Value fields", () => {
    const md = `<!-- slide: Title.1Title.Single -->
# Main Title
## Subtitle

Category: REPORT
Date: 2026-03-31
Footer: Confidential`;

    const deck = parseMd(md);
    const s = deck.slides[0];
    expect(s.layout).toBe("Title.1Title.Single");
    // ctrTitle = idx 0
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "0" }),
    );
    // subtitle = idx 1
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "1" }),
    );
    // Category → idx 10
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "10" }),
    );
    // Date → idx 11
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "11" }),
    );
    // Footer → idx 12
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "12" }),
    );
  });

  // ── Column separator ──

  it("parses two-column layout with <!-- col -->", () => {
    const md = `# Comparison
> Side by Side

<!-- col -->
Left content

<!-- col -->
Right content`;

    const deck = parseMd(md);
    const s = deck.slides[0];
    // idx 1 = left, idx 2 = right
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "1" }),
    );
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "2" }),
    );
  });

  it("parses three-column layout with <!-- col -->", () => {
    const md = `# Three Columns

<!-- col -->
Col 1

<!-- col -->
Col 2

<!-- col -->
Col 3`;

    const deck = parseMd(md);
    const s = deck.slides[0];
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "1" }),
    );
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "2" }),
    );
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "3" }),
    );
  });

  // ── KPI separator ──

  it("parses KPI layout with <!-- kpi -->", () => {
    const md = `# KPIs

<!-- kpi -->
95%
Uptime

<!-- kpi -->
1.2M
Users`;

    const deck = parseMd(md);
    const s = deck.slides[0];
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "1" }),
    );
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "2" }),
    );
  });

  // ── Process steps ──

  it("parses process steps with <!-- step -->", () => {
    const md = `# Roadmap

<!-- step -->
Phase 1
Planning

<!-- step -->
Phase 2
Execution

<!-- step -->
Phase 3
Review`;

    const deck = parseMd(md);
    const s = deck.slides[0];
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "1" }),
    );
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "2" }),
    );
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "3" }),
    );
  });

  // ── Inline formatting ──

  it("parses bold and italic inline formatting", () => {
    const md = `# Title

This has **bold** and *italic* text.`;

    const deck = parseMd(md);
    const body = deck.slides[0].placeholders.find((p) => p.idx === "1");
    expect(body).toBeDefined();
    const segments = body!.paragraphs[0].segments;
    expect(segments).toContainEqual(
      expect.objectContaining({ text: "bold", bold: true }),
    );
    expect(segments).toContainEqual(
      expect.objectContaining({ text: "italic", italic: true }),
    );
  });

  // ── Bullet lists ──

  it("parses bullet list items", () => {
    const md = `# Title

- Item A
- Item B
- Item C`;

    const deck = parseMd(md);
    const body = deck.slides[0].placeholders.find((p) => p.idx === "1");
    expect(body).toBeDefined();
    const bullets = body!.paragraphs.filter((p) => p.bullet);
    expect(bullets).toHaveLength(3);
    expect(bullets[0].segments[0].text).toBe("Item A");
  });

  // ── Source line tracking ──

  it("tracks source line numbers", () => {
    const md = `# Slide 1

Body

---

# Slide 2

Body`;

    const deck = parseMd(md);
    expect(deck.slides[0].sourceLineStart).toBe(1);
    expect(deck.slides[1].sourceLineStart).toBeDefined();
    expect(deck.slides[1].sourceLineStart!).toBeGreaterThan(
      deck.slides[0].sourceLineStart!,
    );
  });

  // ── Diagram blocks ──

  it("parses ```diagram block into DiagramBlock", () => {
    const md = `# Architecture
> System Overview

\`\`\`diagram
type: flowchart
direction: TB
nodes:
  - id: a
    label: Client
  - id: b
    label: Server
edges:
  - from: a
    to: b
\`\`\``;

    const deck = parseMd(md);
    const s = deck.slides[0];
    expect(s.diagram).toBeDefined();
    expect(s.diagram!.yaml).toContain("type: flowchart");
    expect(s.diagram!.yaml).toContain("Client");
    expect(s.diagram!.placeholderIdx).toBe("1");
  });

  it("slide with diagram still has title and subtitle", () => {
    const md = `# Diagram Slide
> Subtitle

\`\`\`diagram
type: flowchart
nodes:
  - id: x
    label: X
\`\`\``;

    const deck = parseMd(md);
    const s = deck.slides[0];
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "15" }),
    );
    expect(s.placeholders).toContainEqual(
      expect.objectContaining({ idx: "16" }),
    );
    expect(s.diagram).toBeDefined();
  });

  it("a ```mermaid FLOWCHART graduates to the canonical DiagramSpec (.diagram)", () => {
    const md = `# Flow
> Overview

\`\`\`mermaid
graph TD
  A[Start] --> B[End]
\`\`\``;

    const deck = parseMd(md);
    const s = deck.slides[0];
    // flowchart Mermaid is converted to DiagramSpec on parse (editable, native shapes)
    expect(s.diagram).toBeDefined();
    expect(s.diagram!.yaml).toContain("Start");
    expect(s.diagram!.yaml).toContain("End");
    expect(s.diagram!.placeholderIdx).toBe("1");
    expect(s.mermaidBlock).toBeUndefined();
  });

  it("an unsupported ```mermaid type stays as a mermaid image fallback", () => {
    // gitGraph/sankey/C4 etc. have no native engine → mermaid.js image. (flowchart/
    // class/sequence/state/ER/timeline/quadrant/pie/gantt/journey/mindmap ARE native.)
    const md = `# Chart

\`\`\`mermaid
gitGraph
  commit
  branch develop
  commit
\`\`\``;

    const s = parseMd(md).slides[0];
    expect(s.mermaidBlock).toBeDefined();
    expect(s.mermaidBlock!.mermaid).toContain("gitGraph");
    expect(s.diagram).toBeUndefined();
  });

  it("non-diagram code blocks are ignored", () => {
    const md = `# Code Example

\`\`\`python
print("hello")
\`\`\``;

    const deck = parseMd(md);
    expect(deck.slides[0].diagram).toBeUndefined();
  });

  // ── Edge cases ──

  it("handles empty body", () => {
    const md = `# Just a Title`;
    const deck = parseMd(md);
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].placeholders).toContainEqual(
      expect.objectContaining({ idx: "15" }),
    );
  });

  it("handles slide with no heading", () => {
    const md = `Just some text without a heading`;
    const deck = parseMd(md);
    expect(deck.slides).toHaveLength(1);
  });

  it("handles multiple --- in a row gracefully", () => {
    const md = `# Slide 1

---

---

# Slide 2`;

    const deck = parseMd(md);
    // Empty slides between separators should be skipped
    const nonEmpty = deck.slides.filter((s) => s.placeholders.length > 0);
    expect(nonEmpty).toHaveLength(2);
  });

  // ── Blockquote handling ──

  it("does not leak '>' markers when a blockquote is not right after the title", () => {
    const md = `# システム概要

本文の説明テキスト

> System Architecture`;

    const deck = parseMd(md);
    const body = deck.slides[0].placeholders.find((p) => p.idx === "1");
    expect(body).toBeDefined();

    const allText = body!.paragraphs
      .flatMap((para) => para.segments.map((seg) => seg.text))
      .join("\n");
    // The literal '>' must never reach the slide; its content still appears.
    expect(allText).not.toContain(">");
    expect(allText).toContain("System Architecture");
  });

  it("maps '> ' to the subtitle (idx 16) even with a blank line after '---'", () => {
    // '---' splitting leaves a leading blank line in the next block; the subtitle
    // detection must still recognize the blockquote (regression: it leaked to body).
    const md = `# 最初のスライド

本文

---

# リスク分析
> Risk Assessment

プロジェクトのリスク説明`;

    const deck = parseMd(md);
    const slide = deck.slides[1];

    const subtitle = slide.placeholders.find((p) => p.idx === "16");
    expect(subtitle).toBeDefined();
    expect(
      subtitle!.paragraphs.flatMap((p) => p.segments.map((s) => s.text)).join(""),
    ).toContain("Risk Assessment");

    // ...and the subtitle text must NOT leak into the body (idx 1).
    const body = slide.placeholders.find((p) => p.idx === "1");
    const bodyText = body
      ? body.paragraphs.flatMap((p) => p.segments.map((s) => s.text)).join("\n")
      : "";
    expect(bodyText).not.toContain("Risk Assessment");
  });
});

// ── #103: nested bullet lists (indent → Paragraph.level, 0-3) ──

describe("parseMd — nested bullets (#103)", () => {
  function bulletsOf(md: string) {
    const deck = parseMd(md);
    const body = deck.slides[0].placeholders.find((p) => p.idx === "1");
    return body!.paragraphs.filter((p) => p.bullet);
  }

  it("2/4/6-space indent → level 1/2/3", () => {
    const md = `# Title

- Root
  - Child (2sp)
    - Grandchild (4sp)
      - Great-grandchild (6sp)`;
    const bullets = bulletsOf(md);
    expect(bullets).toHaveLength(4);
    expect(bullets[0].level).toBeUndefined(); // level 0 stays field-absent (byte-identical gate)
    expect(bullets[1].level).toBe(1);
    expect(bullets[2].level).toBe(2);
    expect(bullets[3].level).toBe(3);
  });

  it("8-space indent CLAMPS to level 3 — content survives, not dropped or errored", () => {
    const md = `# Title

- Root
        - Eight spaces in`;
    const bullets = bulletsOf(md);
    expect(bullets).toHaveLength(2);
    expect(bullets[1].level).toBe(3);
    expect(bullets[1].segments[0].text).toBe("Eight spaces in");
  });

  it("a flat (unindented) bullet deck never gets a level field — byte-identical gate", () => {
    const md = `# Title

- Item A
- Item B
- Item C`;
    const bullets = bulletsOf(md);
    expect(bullets.every((p) => p.level === undefined)).toBe(true);
  });
});

describe("serializeMd(parseMd(...)) — nested bullets round-trip (#103)", () => {
  it("a 3-level-deep nested list round-trips through parse → serialize → parse with the SAME levels", () => {
    const md = `# Title

- Root
  - Level 1
    - Level 2
      - Level 3`;
    const deck1 = parseMd(md);
    const roundTripped = serializeMd(deck1);
    const deck2 = parseMd(roundTripped);

    const levelsOf = (d: typeof deck1) =>
      d.slides[0].placeholders
        .find((p) => p.idx === "1")!
        .paragraphs.filter((p) => p.bullet)
        .map((p) => p.level ?? 0);

    expect(levelsOf(deck1)).toEqual([0, 1, 2, 3]);
    expect(levelsOf(deck2)).toEqual([0, 1, 2, 3]);
  });

  it("an over-indented (clamped) input stabilizes at its rounded form on the NEXT round-trip", () => {
    // 8 spaces clamps to level 3 on first parse; re-serializing must emit the CANONICAL level-3
    // indent (6 spaces), which reparses to the same level 3 — no drift on repeated save/load.
    const md = `# Title

- Root
        - Clamped to level 3`;
    const deck1 = parseMd(md);
    const serialized1 = serializeMd(deck1);
    const deck2 = parseMd(serialized1);
    const serialized2 = serializeMd(deck2);

    expect(serialized1).toBe(serialized2); // stable fixpoint after the first round-trip
    const level = deck2.slides[0].placeholders
      .find((p) => p.idx === "1")!
      .paragraphs.find((p) => p.bullet && p.level)!.level;
    expect(level).toBe(3);
  });

  it("existing flat bullet decks serialize byte-identically (no leading indent introduced)", () => {
    const md = `# Title

- Item A
- Item B`;
    const deck = parseMd(md);
    const serialized = serializeMd(deck);
    expect(serialized).toBe(md.trimEnd() + "\n");
  });
});
