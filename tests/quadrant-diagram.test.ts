/**
 * quadrant-diagram.test.ts — Native quadrant charts (Mermaid quadrantChart →
 * DiagramSpec → editable PPTX shapes). A 2x2 matrix: 4 labelled quadrants, x/y
 * axis labels, and points plotted at normalised [0,1] coordinates.
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema } from "../src/engine/schema";
import { mermaidToDiagramSpec } from "../src/engine/mermaid-to-diagram";
import { diagramSpecToMermaid, canSerializeToMermaid } from "../src/engine/diagram-serialize";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { parseMd } from "../src/engine/md-parser";
import yaml from "js-yaml";

const MMD = `quadrantChart
  title 施策の効果
  x-axis 低リーチ --> 高リーチ
  y-axis 低エンゲージ --> 高エンゲージ
  quadrant-1 拡大
  quadrant-2 訴求強化
  quadrant-3 見直し
  quadrant-4 改善
  施策A: [0.3, 0.6]
  施策B: [0.45, 0.23]
  施策C: [0.7, 0.8]`;

describe("Mermaid quadrantChart parser", () => {
  it("parses title, axis labels, quadrant labels, and points", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    expect(spec.type).toBe("quadrant");
    expect(spec.title).toBe("施策の効果");
    expect(spec.quadrant?.xHigh).toBe("高リーチ");
    expect(spec.quadrant?.yLow).toBe("低エンゲージ");
    expect(spec.quadrant?.q1).toBe("拡大");
    expect(spec.quadrant?.points).toHaveLength(3);
    expect(spec.quadrant?.points[0]).toMatchObject({ label: "施策A", x: 0.3, y: 0.6 });
  });

  it("graduates to .diagram and preserves the quadrant data through serialization", () => {
    const s = parseMd("# Q\n\n```mermaid\n" + MMD + "\n```\n").slides[0];
    expect(s.diagram).toBeDefined();
    expect(s.mermaidBlock).toBeUndefined();
    const spec = DiagramSpecSchema.parse(yaml.load(s.diagram!.yaml));
    expect(spec.quadrant?.q3).toBe("見直し");
    expect(spec.quadrant?.points).toHaveLength(3);
    expect(spec.quadrant?.points[2]).toMatchObject({ label: "施策C", x: 0.7, y: 0.8 });
  });
});

describe("quadrant rendering", () => {
  it("renders quadrant labels, axis labels, points, the cross and 4 cells (native shapes)", () => {
    const svg = renderDiagramToSvg(mermaidToDiagramSpec(MMD)!, {});
    expect(svg).toContain("拡大");
    expect(svg).toContain("高リーチ");
    expect(svg).toContain("施策A");
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(4); // 4 quadrant cells
    expect((svg.match(/<line/g) ?? []).length).toBeGreaterThanOrEqual(2); // the centre cross
    expect((svg.match(/<ellipse/g) ?? []).length).toBeGreaterThanOrEqual(3); // 3 plotted points
  });
});

describe("quadrant round-trips through Mermaid", () => {
  it("spec → Mermaid → spec preserves axes, quadrant labels, and points", () => {
    const spec1 = mermaidToDiagramSpec(MMD)!;
    expect(canSerializeToMermaid(spec1)).toBe(true);
    const spec2 = mermaidToDiagramSpec(diagramSpecToMermaid(spec1))!;
    expect(spec2.title).toBe(spec1.title);
    expect(spec2.quadrant).toEqual(spec1.quadrant);
  });
});
