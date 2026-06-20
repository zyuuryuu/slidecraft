/**
 * mermaid-roundtrip.test.ts — Guard the editor's MERMAID toggle.
 *
 * diagramSpecToMermaid only emits flowchart `graph TD` syntax, so converting a
 * sequence or UML class diagram to Mermaid and back silently FLATTENS it to a
 * flowchart (type: sequence → type: flowchart). canSerializeToMermaid lets the
 * editor disable the MERMAID toggle for those, so the round-trip can't corrupt.
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema } from "../src/engine/schema";
import { canSerializeToMermaid, diagramSpecToMermaid } from "../src/engine/diagram-serialize";
import { mermaidToDiagramSpec } from "../src/engine/mermaid-to-diagram";

const flow = DiagramSpecSchema.parse({
  type: "flowchart",
  direction: "TB",
  nodes: [{ id: "A", label: "A" }, { id: "B", label: "B" }],
  edges: [{ from: "A", to: "B" }],
});
const sequence = DiagramSpecSchema.parse({
  type: "sequence",
  direction: "TB",
  nodes: [{ id: "U", label: "User" }, { id: "A", label: "API" }],
  edges: [{ from: "U", to: "A", label: "req" }],
});
const klass = DiagramSpecSchema.parse({
  type: "flowchart",
  direction: "TB",
  nodes: [{ id: "Animal", label: "Animal", shape: "class", methods: ["+move()"] }, { id: "Dog", label: "Dog", shape: "class" }],
  edges: [{ from: "Animal", to: "Dog", relation: "inheritance" }],
});

describe("canSerializeToMermaid", () => {
  it("allows plain flowcharts", () => {
    expect(canSerializeToMermaid(flow)).toBe(true);
  });
  it("blocks sequence diagrams", () => {
    expect(canSerializeToMermaid(sequence)).toBe(false);
  });
  it("blocks UML class diagrams (class shapes / relations)", () => {
    expect(canSerializeToMermaid(klass)).toBe(false);
  });
});

describe("why the guard matters: the round-trip would corrupt these", () => {
  it("a sequence → Mermaid → spec collapses to a flowchart (the reported bug)", () => {
    const mmd = diagramSpecToMermaid(sequence); // flowchart-only serializer
    const back = mermaidToDiagramSpec(mmd);
    expect(back?.type).toBe("flowchart"); // ← the corruption the guard prevents
    expect(sequence.type).toBe("sequence");
  });
});
