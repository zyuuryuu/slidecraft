/**
 * apply-routing.test.ts — Wave 4 of the adversarial-hunt fixes: the figure/design/markdown apply
 * routing mis-fired on realistic ~3B outputs and destroyed content.
 *  #3A a ```yaml-fenced diagram edit wasn't recognized (fence not stripped) → fell to the Markdown path
 *      and became a stray code block, losing the diagram edit.
 *  #3B a bare DiagramSpec on a TEXT slide ("add a figure") was rejected (guard required an existing
 *      diagram) → parsed as bullets, losing title/body and never creating the figure.
 *  #3C a JSON ops array QUOTED inside prose hijacked the design path → the Markdown was discarded.
 *  #14 a prose-preambled YAML validated as a diagram and was stored with the prose contaminating it.
 */
import { describe, it, expect } from "vitest";
import { applyFigureYaml } from "../src/engine/ai-apply";
import { parseDesignIntent } from "../src/engine/design-intent";
import { validateDiagramSource } from "../src/engine/mermaid-to-diagram";
import type { SlideIR } from "../src/engine/slide-schema";

const YAML = "type: flowchart\ndirection: LR\nnodes:\n  - id: a\n    label: 入力\n  - id: b\n    label: 出力\nedges:\n  - from: a\n    to: b";
const figSlide: SlideIR = {
  layout: "Content.1Body.Single",
  placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "構成" }] }] }, { idx: "1", paragraphs: [{ segments: [{ text: "本文" }], bullet: true }] }],
  diagram: { yaml: "type: flowchart\nnodes:\n  - id: x\n    label: X\nedges: []", placeholderIdx: "1" },
};
const textSlide: SlideIR = {
  layout: "Content.1Body.Single",
  placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "見出し" }] }] }, { idx: "1", paragraphs: [{ segments: [{ text: "本文" }], bullet: true }] }],
};

describe("#14 prose-preambled YAML", () => {
  it("validateDiagramSource rejects prose-contaminated YAML", () => {
    const prose = "はい、こちらが更新した図です:\n\n" + YAML;
    expect(validateDiagramSource(prose, "yaml")).not.toBeNull();
  });
  it("applyFigureYaml strips the prose preamble and stores clean YAML", () => {
    const r = applyFigureYaml(figSlide, "はい、こちらが更新した図です:\n\n" + YAML);
    expect(r).not.toBeNull();
    expect(r!.diagram!.yaml).not.toContain("はい");
    expect(r!.diagram!.yaml).toContain("type: flowchart");
  });
});

describe("#3A fenced diagram edit", () => {
  it("applyFigureYaml unwraps a ```yaml fence and applies the diagram", () => {
    const r = applyFigureYaml(figSlide, "```yaml\n" + YAML + "\n```");
    expect(r).not.toBeNull();
    expect(r!.diagram!.yaml).not.toContain("```");
    expect(r!.diagram!.yaml).toContain("label: 入力");
  });
});

describe("apply routing does not mistake Markdown/text for a figure", () => {
  it("a normal Markdown edit falls through (not mistaken for a figure)", () => {
    expect(applyFigureYaml(figSlide, "# 新見出し\n\n- 要点A\n- 要点B")).toBeNull();
  });
  it("a diagram-less slide is left to the Markdown path (add-figure is out of scope here)", () => {
    expect(applyFigureYaml(textSlide, YAML)).toBeNull();
  });
});

describe("#3C JSON ops array quoted inside prose", () => {
  it("parseDesignIntent does NOT fire on an array embedded in prose", () => {
    expect(parseDesignIntent('図を右に置きました。例: [{"op":"emphasize","nodeId":"db"}]')).toBeNull();
  });
  it("parseDesignIntent still fires on a whole-string ops array", () => {
    const d = parseDesignIntent('[{"op":"relayout","direction":"LR"}]');
    expect(d).not.toBeNull();
  });
});
