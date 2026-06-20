/**
 * er-diagram.test.ts — Native ER diagrams (Mermaid erDiagram → DiagramSpec →
 * editable PPTX shapes, not an image). Entities are name+attribute boxes,
 * relationships are lines with crow's-foot cardinality at each end.
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema } from "../src/engine/schema";
import { mermaidToDiagramSpec } from "../src/engine/mermaid-to-diagram";
import { diagramSpecToMermaid, canSerializeToMermaid } from "../src/engine/diagram-serialize";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { parseMd } from "../src/engine/md-parser";
import yaml from "js-yaml";

const MMD = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  CUSTOMER }o..o| ADDRESS : at
  CUSTOMER {
    string name
    string email
  }`;

describe("Mermaid erDiagram parser", () => {
  it("maps entities to entity boxes with attributes", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    expect(spec).not.toBeNull();
    const cust = spec.nodes.find((n) => n.id === "CUSTOMER")!;
    expect(cust.shape).toBe("entity");
    expect(cust.attributes).toContain("string name");
    expect(cust.attributes).toContain("string email");
  });

  it("decodes crow's-foot cardinality at each end (and `..` = dashed)", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    const order = spec.edges.find((e) => e.to === "ORDER")!;
    expect(order.srcCard).toBe("one"); // ||
    expect(order.tgtCard).toBe("zero_many"); // o{
    const li = spec.edges.find((e) => e.to === "LINE_ITEM")!;
    expect(li.tgtCard).toBe("one_many"); // |{
    const addr = spec.edges.find((e) => e.to === "ADDRESS")!;
    expect(addr.srcCard).toBe("zero_many"); // }o
    expect(addr.tgtCard).toBe("zero_one"); // o|
    expect(addr.style?.dash).toBe(true); // ..
  });

  it("a ```mermaid erDiagram graduates to .diagram and keeps cardinality+attrs", () => {
    const s = parseMd("# ER\n\n```mermaid\n" + MMD + "\n```\n").slides[0];
    expect(s.diagram).toBeDefined();
    expect(s.mermaidBlock).toBeUndefined();
    const spec = DiagramSpecSchema.parse(yaml.load(s.diagram!.yaml));
    expect(spec.edges.find((e) => e.to === "ORDER")?.tgtCard).toBe("zero_many");
    expect(spec.nodes.find((n) => n.id === "CUSTOMER")?.attributes).toContain("string email");
  });
});

describe("ER diagram rendering", () => {
  it("renders entity names + attributes + cardinality markers (native shapes)", () => {
    const svg = renderDiagramToSvg(mermaidToDiagramSpec(MMD)!, {});
    expect(svg).toContain("CUSTOMER");
    expect(svg).toContain("name");
    expect((svg.match(/<line/g) ?? []).length).toBeGreaterThanOrEqual(6); // relationship lines + crow's feet
    expect((svg.match(/<ellipse/g) ?? []).length).toBeGreaterThanOrEqual(1); // zero_* rings
  });
});

describe("ER diagram round-trips through Mermaid", () => {
  it("spec → Mermaid → spec preserves entities, attributes, cardinality, dash", () => {
    const spec1 = mermaidToDiagramSpec(MMD)!;
    expect(canSerializeToMermaid(spec1)).toBe(true);
    const spec2 = mermaidToDiagramSpec(diagramSpecToMermaid(spec1))!;
    expect(spec2.nodes).toEqual(spec1.nodes);
    expect(spec2.edges).toEqual(spec1.edges);
  });
});
