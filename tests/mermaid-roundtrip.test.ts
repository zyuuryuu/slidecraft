/**
 * mermaid-roundtrip.test.ts — The editor's MERMAID toggle must round-trip
 * losslessly. diagramSpecToMermaid dispatches by kind (sequenceDiagram /
 * classDiagram / graph) and mermaidToDiagramSpec reads them back, so a
 * sequence or UML class diagram survives YAML→MERMAID→YAML unchanged (the
 * earlier bug flattened them to `type: flowchart`). canSerializeToMermaid gates
 * the toggle to only the diagrams that round-trip without data loss.
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema } from "../src/engine/schema";
import { canSerializeToMermaid, diagramSpecToMermaid } from "../src/engine/diagram-serialize";
import { mermaidToDiagramSpec } from "../src/engine/mermaid-to-diagram";

const SEQ_MMD = `sequenceDiagram
  participant U as ユーザー
  participant A as API
  U->>+A: login
  alt valid
    A-->>U: token
  else invalid
    A-->>-U: error
  end
  U-)A: async`;

const CLASS_MMD = `classDiagram
  class Animal {
    +name: String
    +makeSound()
  }
  class Dog
  Animal <|-- Dog`;

describe("canSerializeToMermaid gates the MERMAID toggle", () => {
  const flow = DiagramSpecSchema.parse({
    type: "flowchart", direction: "TB",
    nodes: [{ id: "A", label: "A" }, { id: "B", label: "B" }], edges: [{ from: "A", to: "B" }],
  });
  it("allows plain flowcharts and sequence diagrams", () => {
    expect(canSerializeToMermaid(flow)).toBe(true);
    expect(canSerializeToMermaid(mermaidToDiagramSpec(SEQ_MMD)!)).toBe(true);
  });
  it("allows a clean class diagram (name == id, no styles/groups)", () => {
    expect(canSerializeToMermaid(mermaidToDiagramSpec(CLASS_MMD)!)).toBe(true);
  });
  it("blocks a class diagram that would lose data (custom label ≠ id)", () => {
    const labelled = DiagramSpecSchema.parse({
      type: "flowchart", direction: "TB",
      nodes: [{ id: "A", label: "Custom Name", shape: "class" }, { id: "B", label: "B", shape: "class" }],
      edges: [{ from: "A", to: "B", relation: "inheritance" }],
    });
    expect(canSerializeToMermaid(labelled)).toBe(false);
  });
  it("blocks a flowchart with node icons (Mermaid has no icon form → would strip them)", () => {
    const iconned = DiagramSpecSchema.parse({
      type: "flowchart", direction: "TB",
      nodes: [{ id: "a", label: "DB", icon: "database" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }],
    });
    expect(canSerializeToMermaid(iconned)).toBe(false);
  });
  it("blocks kpi / radar (no Mermaid form)", () => {
    const kpi = DiagramSpecSchema.parse({ type: "kpi", direction: "TB", nodes: [], edges: [], kpi: { cards: [{ value: "1", label: "x", delta: "", trend: "up" }] } });
    expect(canSerializeToMermaid(kpi)).toBe(false);
  });
});

describe("flowchart dashed edges round-trip through Mermaid", () => {
  it("parses -.-> as a dashed edge (and --> stays solid)", () => {
    const spec = mermaidToDiagramSpec("graph TD\n  a --> b\n  b -.-> c")!;
    expect(spec.edges[0].style?.dash).toBeFalsy();
    expect(spec.edges[1].style?.dash).toBe(true);
  });
  it("YAML→Mermaid→spec keeps a dashed edge dashed", () => {
    const dashed = DiagramSpecSchema.parse({
      type: "flowchart", direction: "TB",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b", style: { dash: true } }],
    });
    const back = mermaidToDiagramSpec(diagramSpecToMermaid(dashed))!;
    expect(back.edges[0].style?.dash).toBe(true);
  });
});

describe("sequence diagrams round-trip through Mermaid losslessly", () => {
  it("preserves type/participants/messages/fragments/activations", () => {
    const spec1 = mermaidToDiagramSpec(SEQ_MMD)!;
    const spec2 = mermaidToDiagramSpec(diagramSpecToMermaid(spec1))!;
    expect(spec2.type).toBe("sequence");
    expect(spec2.nodes).toEqual(spec1.nodes); // ids + labels (via `as`)
    expect(spec2.edges).toEqual(spec1.edges); // labels + dash (-->>) + async (-) )
    expect(spec2.fragments).toEqual(spec1.fragments); // alt + `else invalid` divider
    expect(spec2.activations).toEqual(spec1.activations); // +/- activation span
  });
});

describe("class diagrams round-trip through Mermaid losslessly", () => {
  it("preserves class shapes, attributes/methods, and UML relations", () => {
    const spec1 = mermaidToDiagramSpec(CLASS_MMD)!;
    const spec2 = mermaidToDiagramSpec(diagramSpecToMermaid(spec1))!;
    expect(spec2.nodes).toEqual(spec1.nodes); // class shape + attributes/methods
    expect(spec2.edges).toEqual(spec1.edges); // inheritance relation, parent first
  });

  it("each UML relation maps to a Mermaid operator and back", () => {
    for (const relation of ["inheritance", "composition", "aggregation", "dependency", "realization"]) {
      const spec = DiagramSpecSchema.parse({
        type: "flowchart", direction: "TB",
        nodes: [{ id: "A", label: "A", shape: "class" }, { id: "B", label: "B", shape: "class" }],
        edges: [{ from: "A", to: "B", relation }],
      });
      const back = mermaidToDiagramSpec(diagramSpecToMermaid(spec))!;
      expect(back.edges[0].relation).toBe(relation);
    }
  });
});
