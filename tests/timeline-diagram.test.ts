/**
 * timeline-diagram.test.ts — Native timelines (Mermaid `timeline` → DiagramSpec →
 * editable PPTX shapes). Periods are nodes (label + event attributes), sections
 * are node groups, rendered as a horizontal axis with marker dots + event cards.
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema } from "../src/engine/schema";
import { mermaidToDiagramSpec } from "../src/engine/mermaid-to-diagram";
import { diagramSpecToMermaid, canSerializeToMermaid } from "../src/engine/diagram-serialize";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { parseMd } from "../src/engine/md-parser";
import * as yaml from "js-yaml";

const MMD = `timeline
  title プロダクト沿革
  section 創業期
    2020 : 創業 : 最初のPoC
    2021 : シード調達
  section 成長期
    2022 : シリーズA : 国内ローンチ
    2023 : 海外展開`;

describe("Mermaid timeline parser", () => {
  it("maps periods to nodes with events, sections to groups, and a title", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    expect(spec.type).toBe("timeline");
    expect(spec.title).toBe("プロダクト沿革");
    const p2022 = spec.nodes.find((n) => n.label === "2022")!;
    expect(p2022.attributes).toEqual(["シリーズA", "国内ローンチ"]);
    expect(p2022.group).toBe("成長期");
    expect(spec.nodes.find((n) => n.label === "2020")?.attributes).toContain("最初のPoC");
  });

  it("graduates to .diagram and preserves sections + events through serialization", () => {
    const s = parseMd("# 沿革\n\n```mermaid\n" + MMD + "\n```\n").slides[0];
    expect(s.diagram).toBeDefined();
    expect(s.mermaidBlock).toBeUndefined();
    const spec = DiagramSpecSchema.parse(yaml.load(s.diagram!.yaml));
    expect(spec.nodes.find((n) => n.label === "2022")?.group).toBe("成長期");
    expect(spec.nodes.find((n) => n.label === "2020")?.attributes).toContain("創業");
  });
});

describe("timeline rendering", () => {
  it("renders period labels, event cards, section labels, and the axis (native shapes)", () => {
    const svg = renderDiagramToSvg(mermaidToDiagramSpec(MMD)!, {});
    expect(svg).toContain("2020");
    expect(svg).toContain("最初のPoC");
    expect(svg).toContain("成長期");
    expect((svg.match(/<line/g) ?? []).length).toBeGreaterThanOrEqual(1); // the time axis
    expect((svg.match(/<ellipse/g) ?? []).length).toBeGreaterThanOrEqual(4); // 4 period marker dots
  });
});

describe("timeline round-trips through Mermaid", () => {
  it("spec → Mermaid → spec preserves title, periods, events, and sections", () => {
    const spec1 = mermaidToDiagramSpec(MMD)!;
    expect(canSerializeToMermaid(spec1)).toBe(true);
    const spec2 = mermaidToDiagramSpec(diagramSpecToMermaid(spec1))!;
    expect(spec2.title).toBe(spec1.title);
    expect(spec2.nodes).toEqual(spec1.nodes);
  });
});
