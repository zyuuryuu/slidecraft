/**
 * ai-apply.test.ts — the AI "diagram-edit" adopt path returns BARE DiagramSpec YAML; applyFigureYaml
 * must swap it into the slide's diagram (parsing it as Markdown lost the edit → "採用しても反映されない").
 */
import { describe, it, expect } from "vitest";
import { applyFigureYaml } from "../src/engine/ai-apply";
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

  it("returns null when the slide has no diagram (nothing to edit)", () => {
    const noDiagram: SlideIR = { layout: "auto", placeholders: [] };
    expect(applyFigureYaml(noDiagram, "type: flowchart\nnodes: []\nedges: []")).toBeNull();
  });

  it("returns null for invalid diagram YAML (keeps the previous figure)", () => {
    expect(applyFigureYaml(withDiagram, "type: flowchart\nnodes: [oops")).toBeNull();
  });
});
