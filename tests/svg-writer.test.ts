/**
 * svg-writer.test.ts — The SVG preview backend must share geometry with PPTX.
 */
import { describe, it, expect } from "vitest";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { computeLayout, SLIDE_W } from "../src/engine/layout-engine";
import type { DiagramSpec } from "../src/engine/schema";

const FLOW: DiagramSpec = {
  type: "flowchart",
  direction: "TB",
  title: "Flow",
  classDefs: {},
  nodes: [
    { id: "a", label: "Alpha", shape: "rounded_rect" },
    { id: "b", label: "Beta", shape: "rect" },
    { id: "c", label: "Gamma", shape: "diamond" },
  ],
  edges: [
    { from: "a", to: "b", label: "next" },
    { from: "b", to: "c" },
  ],
  groups: [],
  lanes: [],
  layout: { node_width: 2.0, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
} as unknown as DiagramSpec;

describe("renderDiagramToSvg", () => {
  it("produces an SVG root with a px viewBox matching the slide size", () => {
    const svg = renderDiagramToSvg(FLOW);
    expect(svg.startsWith("<svg")).toBe(true);
    // 13.333in × 96 = 1279.968 → rounded to 2dp; 7.5in × 96 = 720
    const w = Math.round(SLIDE_W * 96 * 100) / 100;
    expect(svg).toContain(`viewBox="0 0 ${w} 720"`);
  });

  it("renders every node label (escaped) and the title", () => {
    const svg = renderDiagramToSvg(FLOW);
    for (const label of ["Alpha", "Beta", "Gamma", "Flow", "next"]) {
      expect(svg).toContain(label);
    }
  });

  it("draws one shape element per node (rounded rect, rect, diamond)", () => {
    const svg = renderDiagramToSvg(FLOW);
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThanOrEqual(2); // bg + rects
    expect(svg).toContain("<polygon"); // diamond (+ arrowhead)
  });

  it("places nodes at the SAME coordinates as the PPTX layout engine", () => {
    const svg = renderDiagramToSvg(FLOW);
    const positions = computeLayout(FLOW, 1.35); // header bar → contentTop 1.35
    // The first node's left edge (inches→px) should appear in the SVG.
    const a = positions.find((p) => p.nodeId === "a")!;
    const expectedX = Math.round(a.x * 96 * 100) / 100;
    expect(svg).toContain(`x="${expectedX}"`);
  });

  it("confines the whole diagram to a region when given one", () => {
    const region = { x: 7, y: 1.5, w: 5.5, h: 5 }; // right side of the slide
    const svg = renderDiagramToSvg(FLOW, { region, omitTitle: true, transparent: true });
    const xs = [...svg.matchAll(/<rect x="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThan(0);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(region.x * 96 - 2);
      expect(x).toBeLessThanOrEqual((region.x + region.w) * 96 + 2);
    }
  });

  it("escapes markup in labels", () => {
    const spec = { ...FLOW, nodes: [{ id: "x", label: "<b>&", shape: "rect" }], edges: [] } as unknown as DiagramSpec;
    const svg = renderDiagramToSvg(spec);
    expect(svg).toContain("&lt;b&gt;&amp;");
    expect(svg).not.toContain("<b>&amp;");
  });
});
