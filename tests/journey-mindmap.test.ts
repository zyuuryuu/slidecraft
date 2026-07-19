/**
 * journey-mindmap.test.ts — Native user journeys + mindmaps.
 * journey: a satisfaction curve (type "journey", steps reuse node fields).
 * mindmap: an indentation hierarchy mapped to a flowchart tree (LR).
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema } from "../src/engine/schema";
import { mermaidToDiagramSpec } from "../src/engine/mermaid-to-diagram";
import { diagramSpecToMermaid, canSerializeToMermaid } from "../src/engine/diagram-serialize";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { parseMd } from "../src/engine/md-parser";
import * as yaml from "js-yaml";

const JOURNEY = `journey
  title 一日の業務
  section 出社
    お茶をいれる: 5: 私
    階段を上る: 3: 私
    仕事する: 1: 私, 猫
  section 帰宅
    階段を下りる: 4: 私`;

describe("Mermaid journey", () => {
  it("maps steps to nodes (value=score, attributes=actors, group=section)", () => {
    const spec = mermaidToDiagramSpec(JOURNEY)!;
    expect(spec.type).toBe("journey");
    expect(spec.title).toBe("一日の業務");
    const s = spec.nodes.find((n) => n.label === "仕事する")!;
    expect(s.value).toBe(1);
    expect(s.attributes).toEqual(["私", "猫"]);
    expect(s.group).toBe("出社");
  });

  it("graduates to .diagram and renders steps + section bands (native)", () => {
    const slide = parseMd("# J\n\n```mermaid\n" + JOURNEY + "\n```\n").slides[0];
    expect(slide.diagram).toBeDefined();
    const spec = DiagramSpecSchema.parse(yaml.load(slide.diagram!.yaml));
    expect(spec.nodes.find((n) => n.label === "お茶をいれる")?.value).toBe(5);
    const svg = renderDiagramToSvg(spec, {});
    expect(svg).toContain("お茶をいれる");
    expect(svg).toContain("出社");
    expect((svg.match(/<ellipse/g) ?? []).length).toBeGreaterThanOrEqual(4); // 4 step points
  });

  it("round-trips through Mermaid", () => {
    const spec1 = mermaidToDiagramSpec(JOURNEY)!;
    expect(canSerializeToMermaid(spec1)).toBe(true);
    expect(mermaidToDiagramSpec(diagramSpecToMermaid(spec1))!.nodes).toEqual(spec1.nodes);
  });
});

const MINDMAP = `mindmap
  root((中心テーマ))
    起源
      長い歴史
      普及
    研究
      効果について`;

describe("Mermaid mindmap", () => {
  it("builds a flowchart tree from the indentation hierarchy", () => {
    const spec = mermaidToDiagramSpec(MINDMAP)!;
    expect(spec.type).toBe("flowchart");
    expect(spec.nodes).toHaveLength(6);
    const root = spec.nodes[0];
    expect(root.label).toBe("中心テーマ");
    expect(root.shape).toBe("circle");
    const origin = spec.nodes.find((n) => n.label === "起源")!;
    const history = spec.nodes.find((n) => n.label === "長い歴史")!;
    expect(spec.edges.some((e) => e.from === root.id && e.to === origin.id)).toBe(true); // root → 起源
    expect(spec.edges.some((e) => e.from === origin.id && e.to === history.id)).toBe(true); // 起源 → 長い歴史
  });

  it("graduates to .diagram (indentation preserved) and renders node labels", () => {
    const slide = parseMd("# M\n\n```mermaid\n" + MINDMAP + "\n```\n").slides[0];
    expect(slide.diagram).toBeDefined();
    const spec = DiagramSpecSchema.parse(yaml.load(slide.diagram!.yaml));
    expect(spec.nodes).toHaveLength(6); // hierarchy survived (indentation not trimmed away)
    expect(renderDiagramToSvg(spec, {})).toContain("中心テーマ");
  });
});
