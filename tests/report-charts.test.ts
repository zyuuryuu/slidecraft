/**
 * report-charts.test.ts — Report-grade data charts.
 * xychart: Mermaid xychart-beta (bar + line). radar / kpi: DiagramSpec-authored.
 * All render as native shapes (preview SVG == PPTX), no raster images.
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema } from "../src/engine/schema";
import { mermaidToDiagramSpec } from "../src/engine/mermaid-to-diagram";
import { diagramSpecToMermaid, canSerializeToMermaid, diagramSpecToYaml } from "../src/engine/diagram-serialize";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { parseMd } from "../src/engine/md-parser";
import yaml from "js-yaml";

const XY = `xychart-beta
  title "Sales"
  x-axis [Q1, Q2, Q3, Q4]
  y-axis "売上" 0 --> 1000
  bar [450, 620, 710, 880]
  line [400, 580, 690, 850]`;

describe("xychart (bar + line)", () => {
  it("parses to type xychart with categories + 2 series, renders bars + line", () => {
    const spec = mermaidToDiagramSpec(XY)!;
    expect(spec.type).toBe("xychart");
    expect(spec.xychart?.categories).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(spec.xychart?.series.map((s) => s.kind)).toEqual(["bar", "line"]);
    const svg = renderDiagramToSvg(spec, {});
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(4); // 4 bars
    expect(svg).toContain("Q1");
    expect(svg).not.toContain("<image");
  });
  it("graduates from a ```mermaid fence and round-trips through Mermaid", () => {
    expect(parseMd("# C\n\n```mermaid\n" + XY + "\n```\n").slides[0].diagram).toBeDefined();
    const spec = mermaidToDiagramSpec(XY)!;
    expect(canSerializeToMermaid(spec)).toBe(true);
    const rt = mermaidToDiagramSpec(diagramSpecToMermaid(spec))!;
    expect(rt.xychart?.series[1].values).toEqual([400, 580, 690, 850]);
  });
});

describe("radar (spider chart)", () => {
  const radar = () => DiagramSpecSchema.parse({
    type: "radar", direction: "TB", title: "評価", nodes: [], edges: [],
    radar: { max: 5, axes: ["技術", "コスト", "品質", "速度", "保守"], series: [{ name: "A", values: [4, 3, 5, 2, 4] }, { name: "B", values: [3, 5, 3, 4, 2] }] },
  });
  it("renders axes + rings + series as native lines", () => {
    const svg = renderDiagramToSvg(radar(), {});
    expect(svg).toContain("技術");
    expect((svg.match(/<line/g) ?? []).length).toBeGreaterThan(10); // 4 rings + 5 spokes + 2 series
    expect(svg).not.toContain("<image");
  });
  it("round-trips through YAML (radar sub-object preserved)", () => {
    const back = DiagramSpecSchema.parse(yaml.load(diagramSpecToYaml(radar())));
    expect(back.radar?.axes).toHaveLength(5);
    expect(back.radar?.series[1].values).toEqual([3, 5, 3, 4, 2]);
  });
  it("cannot serialize to Mermaid — the toggle must stay disabled (no destructive stub)", () => {
    expect(canSerializeToMermaid(radar())).toBe(false);
  });
});

describe("kpi (stat cards)", () => {
  const kpi = () => DiagramSpecSchema.parse({
    type: "kpi", direction: "TB", nodes: [], edges: [],
    kpi: { cards: [{ value: "1.2億", label: "売上", delta: "+15%", trend: "up" }, { value: "98%", label: "達成率", delta: "-1pt", trend: "down" }] },
  });
  it("renders one card panel per KPI with value/label/delta", () => {
    const svg = renderDiagramToSvg(kpi(), {});
    for (const s of ["1.2億", "売上", "+15%", "98%"]) expect(svg).toContain(s);
    expect(svg).not.toContain("<image");
  });
  it("round-trips through YAML (kpi cards preserved, value stays a string)", () => {
    const back = DiagramSpecSchema.parse(yaml.load(diagramSpecToYaml(kpi())));
    expect(back.kpi?.cards).toHaveLength(2);
    expect(back.kpi?.cards[0]).toMatchObject({ value: "1.2億", trend: "up" });
  });
  it("cannot serialize to Mermaid — toggle disabled (diagramSpecToMermaid has no kpi form)", () => {
    expect(canSerializeToMermaid(kpi())).toBe(false);
  });
});

describe("diagramSpecToYaml robustness", () => {
  // A partial (non-schema-parsed) spec — e.g. JSON.parse of an edited diagram — must
  // not crash the serializer (it's called on the editor's raw text on every toggle).
  it("does not throw on partial specs missing optional arrays / labels", () => {
    expect(() => diagramSpecToYaml({ type: "flowchart", direction: "TB", nodes: [{ id: "a" }] } as never)).not.toThrow();
    expect(() => diagramSpecToYaml({ type: "kpi", direction: "TB", nodes: [], kpi: {} } as never)).not.toThrow();
    expect(() => diagramSpecToYaml({ type: "radar", direction: "TB", nodes: [], radar: { max: 5, axes: [] } } as never)).not.toThrow();
  });
});
