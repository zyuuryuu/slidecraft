/**
 * diagram-icons.test.ts — Built-in node icons drawn as NATIVE shapes (composed
 * from DrawTarget primitives → preview SVG == PPTX, editable, no raster images).
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema, BUILTIN_ICONS } from "../src/engine/schema";
import { renderDiagramToSvg } from "../src/engine/svg-writer";

const mk = (icon?: string) =>
  DiagramSpecSchema.parse({
    type: "network", direction: "LR",
    nodes: [{ id: "a", label: "Node A", ...(icon ? { icon } : {}) }],
    edges: [],
  });

describe("node icons", () => {
  it("every BUILTIN_ICONS name renders extra native shapes (no crash, no image)", () => {
    const base = renderDiagramToSvg(mk(), {});
    const baseShapes = (base.match(/<rect|<ellipse|<line|<polygon/g) ?? []).length;
    for (const name of BUILTIN_ICONS) {
      const svg = renderDiagramToSvg(mk(name), {});
      expect(svg).not.toContain("<image"); // native shapes, NOT an embedded raster
      expect((svg.match(/<rect|<ellipse|<line|<polygon/g) ?? []).length).toBeGreaterThan(baseShapes);
      expect(svg).toContain("Node A"); // label kept
    }
  });

  it("the database icon draws a cylinder (ellipses), label stays", () => {
    const svg = renderDiagramToSvg(mk("database"), {});
    expect((svg.match(/<ellipse/g) ?? []).length).toBeGreaterThanOrEqual(2); // top + bottom of the cylinder
    expect(svg).toContain("Node A");
  });

  it("an unknown icon name is ignored (label centred, no glyph)", () => {
    const svg = renderDiagramToSvg(mk("nonexistent"), {});
    expect(svg).toContain("Node A");
    expect(svg).not.toContain("<image");
  });
});
