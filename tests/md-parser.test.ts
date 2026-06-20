/**
 * md-parser.test.ts — Tests for Markdown → SlideIR[] parser.
 */

import { describe, it, expect } from "vitest";
import { parseMd } from "../src/engine/md-parser";
import type { DeckIR, SlideIR } from "../src/engine/slide-schema";

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
    // journey/gantt/mindmap etc. have no native engine yet → mermaid.js image.
    // (pie/quadrant/timeline/state/ER ARE native now and graduate to .diagram.)
    const md = `# Chart

\`\`\`mermaid
journey
  title My working day
  section Go to work
    Make tea: 5: Me
    Drive: 3: Me
\`\`\``;

    const s = parseMd(md).slides[0];
    expect(s.mermaidBlock).toBeDefined();
    expect(s.mermaidBlock!.mermaid).toContain("journey");
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
