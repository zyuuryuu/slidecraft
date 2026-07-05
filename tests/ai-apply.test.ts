/**
 * ai-apply.test.ts — the AI "diagram-edit" adopt path returns BARE DiagramSpec YAML; applyFigureYaml
 * must swap it into the slide's diagram (parsing it as Markdown lost the edit → "採用しても反映されない").
 */
import { describe, it, expect } from "vitest";
import { applyFigureYaml, previewFigureEdit, figureFence } from "../src/engine/ai-apply";
import type { SlideIR } from "../src/engine/slide-schema";

const withDiagram: SlideIR = {
  layout: "auto",
  placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "図" }] }] }],
  diagram: { yaml: "type: flowchart\nnodes: []\nedges: []", placeholderIdx: "1" },
};

describe("applyFigureYaml", () => {
  it("swaps a bare DiagramSpec YAML into the slide's existing diagram", () => {
    const raw = "type: flowchart\ndirection: LR\nnodes:\n  - id: a\n    label: A\n  - id: b\n    label: B\nedges:\n  - from: a\n    to: b";
    const r = applyFigureYaml(withDiagram, raw);
    expect(r).not.toBeNull();
    expect(r!.diagram!.yaml).toBe(raw); // the edit is APPLIED (was previously dropped)
    expect(r!.diagram!.placeholderIdx).toBe("1"); // placement preserved
  });

  it("returns null for Markdown text — the caller falls back to parseMd", () => {
    expect(applyFigureYaml(withDiagram, "# タイトル\n\n- 箇条書き")).toBeNull();
  });

  it("ADDS a figure to a body-less slide (図無し→図追加, #3B)", () => {
    const noDiagram: SlideIR = { layout: "auto", placeholders: [] };
    const r = applyFigureYaml(noDiagram, "type: flowchart\nnodes: []\nedges: []");
    expect(r).not.toBeNull();
    expect(r!.diagram).toBeDefined();
    expect(r!.diagram!.placeholderIdx).toBe("1"); // body-less → the figure fills the body
  });

  it("returns null for invalid diagram YAML (keeps the previous figure)", () => {
    expect(applyFigureYaml(withDiagram, "type: flowchart\nnodes: [oops")).toBeNull();
  });
});

describe("previewFigureEdit — diagram edit diffs YAML-vs-YAML (図編集 diff の見た目)", () => {
  const newYaml = "type: flowchart\ndirection: LR\nnodes:\n  - id: a\n    label: A\nedges: []";

  it("diffs the OLD figure fence against the NEW figure fence — no slide body text on either side", () => {
    const p = previewFigureEdit(withDiagram, newYaml);
    expect(p).not.toBeNull();
    // both sides are fenced figure SOURCE, not the slide's Markdown
    expect(p!.beforeMd).toBe("```diagram\ntype: flowchart\nnodes: []\nedges: []\n```");
    expect(p!.afterMd).toBe("```diagram\n" + newYaml + "\n```");
    expect(p!.beforeMd).not.toContain("# "); // the slide title (idx 15 "図") is NOT in the diff
    expect(p!.afterMd).not.toContain("図");
  });

  it("returns null for a plain Markdown edit (caller keeps the Markdown diff)", () => {
    expect(previewFigureEdit(withDiagram, "# タイトル\n\n- 箇条書き")).toBeNull();
  });

  it("ADD case: a figureless slide has an empty before side (pure addition)", () => {
    const noDiagram: SlideIR = { layout: "auto", placeholders: [] };
    const p = previewFigureEdit(noDiagram, newYaml);
    expect(p).not.toBeNull();
    expect(p!.beforeMd).toBe(""); // nothing to diff against → add-only
    expect(p!.afterMd).toContain("```diagram");
  });

  it("figureFence renders diagram and mermaid sources, undefined when neither", () => {
    expect(figureFence(withDiagram)).toBe("```diagram\ntype: flowchart\nnodes: []\nedges: []\n```");
    const merm: SlideIR = { layout: "auto", placeholders: [], mermaidBlock: { mermaid: "graph TD;A-->B", placeholderIdx: "1" } };
    expect(figureFence(merm)).toBe("```mermaid\ngraph TD;A-->B\n```");
    expect(figureFence({ layout: "auto", placeholders: [] })).toBeUndefined();
  });
});
