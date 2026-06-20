/**
 * class-diagram.test.ts — Native UML class diagrams (rendered as PPTX objects,
 * not images). Milestone 1: the class-node model + 3-compartment rendering.
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema } from "../src/engine/schema";
import { computeLayout } from "../src/engine/layout-engine";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { mermaidToDiagramSpec } from "../src/engine/mermaid-to-diagram";
import { parseMd } from "../src/engine/md-parser";

const SPEC = DiagramSpecSchema.parse({
  type: "flowchart",
  direction: "TB",
  nodes: [
    {
      id: "Animal",
      label: "Animal",
      shape: "class",
      attributes: ["+name: String", "+age: int"],
      methods: ["+makeSound()", "+move()"],
    },
    { id: "Dog", label: "Dog", shape: "class", methods: ["+bark()"] },
  ],
  edges: [{ from: "Animal", to: "Dog", relation: "inheritance" }],
});

describe("class diagram model + rendering (milestone 1)", () => {
  it("the schema accepts attributes/methods/class shape/relation", () => {
    expect(SPEC.nodes[0].shape).toBe("class");
    expect(SPEC.nodes[0].attributes).toEqual(["+name: String", "+age: int"]);
    expect(SPEC.nodes[0].methods).toEqual(["+makeSound()", "+move()"]);
    expect(SPEC.edges[0].relation).toBe("inheritance");
  });

  it("a class node is sized taller to fit its compartments", () => {
    const pos = computeLayout(SPEC);
    const animal = pos.find((p) => p.nodeId === "Animal")!;
    const dog = pos.find((p) => p.nodeId === "Dog")!;
    expect(animal.h).toBeGreaterThan(1.0); // 4 members → much taller than the 0.7 default
    expect(animal.h).toBeGreaterThan(dog.h); // more members → taller
  });

  it("renders the name + attributes + methods (native shapes/text, not an image)", () => {
    const svg = renderDiagramToSvg(SPEC, {});
    expect(svg).toContain("Animal");
    expect(svg).toContain("name");
    expect(svg).toContain("makeSound");
    // compartment dividers + the edge → multiple line/path elements
    expect((svg.match(/<line|<path|<polyline/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("Mermaid classDiagram parser (milestone 2)", () => {
  const MMD = `classDiagram
  class Animal {
    +String name
    +int age
    +makeSound()
  }
  class Dog
  Animal <|-- Dog
  Animal *-- Tail : has`;

  it("parses classes with attributes/methods + UML relations", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    expect(spec).not.toBeNull();
    const animal = spec.nodes.find((n) => n.id === "Animal")!;
    expect(animal.shape).toBe("class");
    expect(animal.attributes).toContain("+String name");
    expect(animal.methods).toContain("+makeSound()");
    // inheritance keeps the parent as `from` (Animal); composition for *--
    expect(spec.edges.find((e) => e.to === "Dog")?.relation).toBe("inheritance");
    expect(spec.edges.find((e) => e.to === "Tail")?.relation).toBe("composition");
    // referenced-only classes become (empty) class nodes too
    expect(spec.nodes.some((n) => n.id === "Tail" && n.shape === "class")).toBe(true);
  });

  it("a ```mermaid classDiagram graduates to an editable .diagram on parse", () => {
    const md = "# クラス図\n\n```mermaid\n" + MMD + "\n```\n";
    const s = parseMd(md).slides[0];
    expect(s.diagram).toBeDefined(); // native, editable — NOT a mermaid image
    expect(s.mermaidBlock).toBeUndefined();
    expect(s.diagram!.yaml).toContain("class");
  });
});

describe("UML relationship rendering (milestone 3)", () => {
  const mk = (relation: string) =>
    DiagramSpecSchema.parse({
      type: "flowchart",
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "class" }, { id: "B", label: "B", shape: "class" }],
      edges: [{ from: "A", to: "B", relation }],
    });
  const segs = (s: string) => (s.match(/<line|<polyline|<path|<polygon/g) ?? []).length;

  it("inheritance adds a triangle marker (more outline segments than a plain association)", () => {
    expect(segs(renderDiagramToSvg(mk("inheritance"), {}))).toBeGreaterThan(
      segs(renderDiagramToSvg(mk("association"), {})),
    );
  });
  it("realization and dependency draw a dashed line", () => {
    expect(renderDiagramToSvg(mk("realization"), {})).toMatch(/dasharray/i);
    expect(renderDiagramToSvg(mk("dependency"), {})).toMatch(/dasharray/i);
  });
  it("composition draws a filled diamond marker", () => {
    expect(renderDiagramToSvg(mk("composition"), {})).toMatch(/<polygon|<path/);
  });
});
