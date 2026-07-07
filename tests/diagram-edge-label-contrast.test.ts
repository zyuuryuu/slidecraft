/**
 * diagram-edge-label-contrast.test.ts — M11: edge LABELS must be readable on the slide background.
 * They previously reused edge_color (#94A3B8, a subtle grey ~2.4:1 on the light slide bg = hard to
 * read); now the connector LINE keeps that subtle grey but the LABEL uses a contrast-adaptive dark
 * colour. Shared painter → this holds for both the preview SVG and the exported PPTX.
 */
import { describe, it, expect } from "vitest";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { DiagramSpecSchema } from "../src/engine/schema";

const flowWithLabel = (label: string) =>
  DiagramSpecSchema.parse({
    type: "flowchart",
    direction: "LR",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    edges: [{ from: "a", to: "b", label }],
  });

describe("edge label contrast (M11)", () => {
  it("renders the edge label in a dark, readable colour on the light slide (not the subtle line grey)", () => {
    const svg = renderDiagramToSvg(flowWithLabel("ZLABELZ"), {});
    const m = svg.match(/fill="(#[0-9A-Fa-f]{6})"[^>]*>ZLABELZ/);
    expect(m, "edge label run not found in SVG").toBeTruthy();
    expect(m![1].toUpperCase()).toBe("#1E293B"); // dark readable, ~13:1 on #F5F7FA
    // the connector LINE keeps the subtle grey — we only darkened the TEXT, not the line
    expect(svg).toMatch(/#94A3B8/i);
  });

  it("honours a per-edge custom colour on its own label", () => {
    const spec = DiagramSpecSchema.parse({
      type: "flowchart",
      direction: "LR",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b", label: "ZLABELZ", style: { color: "#FF0000" } }],
    });
    const svg = renderDiagramToSvg(spec, {});
    expect(svg).toMatch(/fill="#FF0000"[^>]*>ZLABELZ/i); // custom edge colour applies to its label
  });
});
