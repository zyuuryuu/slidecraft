/**
 * class-diagram.test.ts — Native UML class diagrams (rendered as PPTX objects,
 * not images). Milestone 1: the class-node model + 3-compartment rendering.
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema } from "../src/engine/schema";
import { computeLayout } from "../src/engine/layout-engine";
import { renderDiagramToSvg } from "../src/engine/svg-writer";

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
