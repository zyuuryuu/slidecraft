/**
 * svg-writer-text.test.ts — diagram text is rendered as native SVG <text>/<tspan>
 * (not <foreignObject>), so it survives canvas rasterization and WebKitGTK/headless
 * print-to-PDF. Since preview + HTML export share renderDiagramToSvg, this keeps them
 * WYSIWYG-identical AND print-robust (ADR-0003). Also covers the wrapToWidth soft-wrap
 * that replaces foreignObject's CSS wrapping for the opts.wrap labels.
 */
import { describe, it, expect } from "vitest";
import { renderDiagramToSvg, wrapToWidth } from "../src/engine/svg-writer";
import type { DiagramSpec } from "../src/engine/schema";

const FLOW: DiagramSpec = {
  type: "flowchart",
  direction: "TB",
  title: "Flow",
  classDefs: {},
  nodes: [
    { id: "a", label: "Alpha", shape: "rounded_rect" },
    { id: "b", label: "Beta", shape: "rect" },
  ],
  edges: [{ from: "a", to: "b", label: "next" }],
  groups: [],
  lanes: [],
  layout: { node_width: 2.0, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
} as unknown as DiagramSpec;

describe("svg-writer native <text> mode", () => {
  it("emits <text>/<tspan> and NO <foreignObject> (print/canvas robust)", () => {
    const svg = renderDiagramToSvg(FLOW);
    expect(svg).toContain("<text ");
    expect(svg).toContain("<tspan ");
    expect(svg).not.toContain("<foreignObject");
    expect(svg).not.toContain('xmlns="http://www.w3.org/1999/xhtml"');
  });

  it("still renders every label + title (as tspan text)", () => {
    const svg = renderDiagramToSvg(FLOW);
    for (const label of ["Alpha", "Beta", "Flow", "next"]) expect(svg).toContain(label);
  });

  it("maps a centered node label to text-anchor=middle", () => {
    const svg = renderDiagramToSvg(FLOW);
    expect(svg).toMatch(/<text text-anchor="middle">/);
  });

  it("carries per-run fill + font-weight onto each tspan", () => {
    const svg = renderDiagramToSvg(FLOW);
    // node labels are bold (diagram-draw) → font-weight 700, color via fill=
    expect(svg).toMatch(/<tspan[^>]*font-weight="700"[^>]*fill="#[0-9A-Fa-f]{3,6}"/);
  });

  it("escapes markup in tspan text (no breakout)", () => {
    const spec = { ...FLOW, nodes: [{ id: "x", label: "<b>&", shape: "rect" }], edges: [] } as unknown as DiagramSpec;
    const svg = renderDiagramToSvg(spec);
    expect(svg).toContain("&lt;b&gt;&amp;");
    expect(svg).not.toContain("<b>&amp;");
    expect(svg).not.toMatch(/ on\w+="/); // no injected event handler
  });

  it("keeps geometry: node rects present at layout coordinates (R5 unaffected)", () => {
    const svg = renderDiagramToSvg(FLOW);
    // the text change must not move any shape — rects/polygons still present
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("shrinks an over-long label to fit its box (no spill; mirrors PPTX fit:shrink)", () => {
    // 60 chars in a ~2in node box forces a substantial shrink below the 11pt (~14.7px) default,
    // so the label stays inside its box instead of overflowing (foreignObject clipped; <text> can't).
    const spec = { ...FLOW, nodes: [{ id: "x", label: "X".repeat(60), shape: "rect" }], edges: [] } as unknown as DiagramSpec;
    const svg = renderDiagramToSvg(spec);
    const sizes = [...svg.matchAll(/<tspan[^>]*font-size="([\d.]+)px"/g)].map((m) => Number(m[1]));
    expect(sizes.some((s) => s < 10)).toBe(true);
  });
});

describe("wrapToWidth (soft-wrap for opts.wrap labels)", () => {
  it("keeps a short string on one line", () => {
    expect(wrapToWidth("Hi", 500, 16)).toEqual(["Hi"]);
  });
  it("wraps a long latin string across multiple lines at word boundaries", () => {
    const lines = wrapToWidth("the quick brown fox jumps over", 60, 16);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ").replace(/\s+/g, " ")).toContain("quick");
  });
  it("hard-breaks a spaceless CJK run and reconstructs it exactly", () => {
    const lines = wrapToWidth("あいうえおかきくけこ", 48, 16); // ~3 CJK glyphs per 48px line
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("あいうえおかきくけこ");
  });
});
