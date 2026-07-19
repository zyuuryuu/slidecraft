/**
 * pie-diagram.test.ts — Native pie charts (Mermaid pie → DiagramSpec → editable
 * PPTX shapes). Slices are nodes (label + value), drawn as native wedges
 * (DrawTarget.wedge → PPTX `pie` shape + preview SVG path), with a legend.
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema } from "../src/engine/schema";
import { mermaidToDiagramSpec } from "../src/engine/mermaid-to-diagram";
import { diagramSpecToMermaid, canSerializeToMermaid } from "../src/engine/diagram-serialize";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { parseMd } from "../src/engine/md-parser";
import * as yaml from "js-yaml";

const MMD = `pie title ペット
  "犬" : 386
  "猫" : 85
  "鳥" : 29`;

describe("Mermaid pie parser", () => {
  it("parses the title and slices (label + value)", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    expect(spec.type).toBe("pie");
    expect(spec.title).toBe("ペット");
    expect(spec.nodes.map((n) => [n.label, n.value])).toEqual([["犬", 386], ["猫", 85], ["鳥", 29]]);
  });

  it("graduates to .diagram and preserves slice values through serialization", () => {
    const s = parseMd("# 円\n\n```mermaid\n" + MMD + "\n```\n").slides[0];
    expect(s.diagram).toBeDefined();
    expect(s.mermaidBlock).toBeUndefined();
    const spec = DiagramSpecSchema.parse(yaml.load(s.diagram!.yaml));
    expect(spec.nodes.find((n) => n.label === "犬")?.value).toBe(386);
  });
});

describe("pie rendering", () => {
  it("renders wedges + legend + % labels as native shapes", () => {
    const svg = renderDiagramToSvg(mermaidToDiagramSpec(MMD)!, {});
    expect(svg).toContain("犬"); // legend label
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(3); // 3 wedges
    expect(svg).toMatch(/%/); // a percentage label
  });
});

describe("pie round-trips through Mermaid", () => {
  it("spec → Mermaid → spec preserves title and slices", () => {
    const spec1 = mermaidToDiagramSpec(MMD)!;
    expect(canSerializeToMermaid(spec1)).toBe(true);
    const spec2 = mermaidToDiagramSpec(diagramSpecToMermaid(spec1))!;
    expect(spec2.title).toBe(spec1.title);
    expect(spec2.nodes).toEqual(spec1.nodes);
  });
});
