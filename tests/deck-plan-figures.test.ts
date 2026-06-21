/**
 * deck-plan-figures.test.ts — AI full-deck generation can now emit TABLES and
 * DIAGRAMS (not just text/columns): the new "table" + "diagram" DeckPlan kinds,
 * their salvage of weak-model output, and the prompt teaching them.
 */
import { describe, it, expect } from "vitest";
import { extractDeckPlan, deckPlanToDeck, deckPlanSystemPrompt } from "../src/engine/deck-plan";

function build(slides: unknown[]) {
  const r = extractDeckPlan(JSON.stringify({ slides }));
  if (!r.ok) throw new Error(r.error);
  return deckPlanToDeck(r.plan).slides;
}

describe("DeckPlan table kind", () => {
  it("table plan → SlideIR with a native table block (headers prepended)", () => {
    const [s] = build([{ kind: "table", title: "料金プラン", headers: ["プラン", "月額"], rows: [["Free", "¥0"], ["Pro", "¥1,200"]] }]);
    expect(s.table?.rows).toEqual([["プラン", "月額"], ["Free", "¥0"], ["Pro", "¥1,200"]]);
    expect(s.table?.header).toBe(true);
    expect(s.placeholders.find((p) => p.idx === "15")?.paragraphs[0].segments[0].text).toBe("料金プラン");
  });
  it("salvages a synonym kind + a rows-only table (first row = header)", () => {
    const [s] = build([{ kind: "grid", title: "T", rows: [["H1", "H2"], ["a", "b"]] }]);
    expect(s.table?.rows).toEqual([["H1", "H2"], ["a", "b"]]);
  });
});

describe("DeckPlan diagram kind", () => {
  it("diagram plan (mermaid) → native diagram block", () => {
    const [s] = build([{ kind: "diagram", title: "フロー", mermaid: "flowchart LR\n  A[開始] --> B[完了]" }]);
    expect(s.diagram?.yaml).toContain("開始");
    expect(s.mermaidBlock).toBeUndefined();
  });
  it("non-native mermaid falls back to a mermaidBlock", () => {
    const [s] = build([{ kind: "diagram", title: "X", mermaid: "gitGraph\n  commit" }]);
    expect(s.mermaidBlock?.mermaid).toContain("gitGraph");
    expect(s.diagram).toBeUndefined();
  });
  it("salvages a 'flowchart' synonym kind", () => {
    const [s] = build([{ kind: "flowchart", title: "T", mermaid: "flowchart TD\n  A --> B" }]);
    expect(s.diagram).toBeDefined();
  });
});

describe("prompt", () => {
  it("teaches the table + diagram kinds (with Mermaid)", () => {
    const p = deckPlanSystemPrompt();
    expect(p).toContain('"kind":"table"');
    expect(p).toContain('"kind":"diagram"');
    expect(p).toContain("mermaid");
  });
});
