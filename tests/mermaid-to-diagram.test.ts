import { describe, it, expect } from "vitest";
import {
  mermaidToDiagramSpec,
  diagramSpecToMermaid,
  diagramSpecToYaml,
} from "../src/engine/mermaid-to-diagram";

describe("mermaidToDiagramSpec", () => {
  it("parses simple TD graph", () => {
    const mmd = `graph TD
  A["Start"] --> B["End"]`;
    const spec = mermaidToDiagramSpec(mmd);
    expect(spec).not.toBeNull();
    expect(spec!.direction).toBe("TB");
    expect(spec!.nodes).toHaveLength(2);
    expect(spec!.edges).toHaveLength(1);
    expect(spec!.edges[0].from).toBe("A");
    expect(spec!.edges[0].to).toBe("B");
  });

  it("parses LR graph", () => {
    const mmd = `graph LR
  A --> B --> C`;
    const spec = mermaidToDiagramSpec(mmd);
    expect(spec!.direction).toBe("LR");
    expect(spec!.nodes).toHaveLength(3);
    expect(spec!.edges).toHaveLength(2);
  });

  it("detects node shapes", () => {
    const mmd = `graph TD
  A("Rounded")
  B{{"Diamond"}}
  C["Rect"]`;
    const spec = mermaidToDiagramSpec(mmd);
    expect(spec!.nodes.find(n => n.id === "A")!.shape).toBe("rounded_rect");
    expect(spec!.nodes.find(n => n.id === "B")!.shape).toBe("diamond");
    expect(spec!.nodes.find(n => n.id === "C")!.shape).toBe("rect");
  });

  it("parses edge labels", () => {
    const mmd = `graph TD
  A -->|Yes| B
  A -->|No| C`;
    const spec = mermaidToDiagramSpec(mmd);
    expect(spec!.edges).toHaveLength(2);
    expect(spec!.edges[0].label).toBe("Yes");
    expect(spec!.edges[1].label).toBe("No");
  });

  it("parses Japanese labels", () => {
    const mmd = `graph TD
  A["開始"] --> B["処理"]`;
    const spec = mermaidToDiagramSpec(mmd);
    expect(spec!.nodes[0].label).toBe("開始");
    expect(spec!.nodes[1].label).toBe("処理");
  });

  it("parses subgraph into groups", () => {
    const mmd = `graph TD
  subgraph web["Web Tier"]
    A["Nginx 1"]
    B["Nginx 2"]
  end
  subgraph app["App Tier"]
    C["API Gateway"]
  end
  A --> C
  B --> C`;
    const spec = mermaidToDiagramSpec(mmd);
    expect(spec).not.toBeNull();
    expect(spec!.groups).toHaveLength(2);
    expect(spec!.groups[0].label).toBe("Web Tier");
    expect(spec!.groups[1].label).toBe("App Tier");
    // Nodes should have group assignment
    expect(spec!.nodes.find(n => n.id === "A")!.group).toBe("web");
    expect(spec!.nodes.find(n => n.id === "C")!.group).toBe("app");
    expect(spec!.edges).toHaveLength(2);
  });

  it("handles nested references in subgraph", () => {
    const mmd = `graph LR
  subgraph dmz["DMZ"]
    fw["Firewall"]
    lb["Load Balancer"]
  end
  inet["Internet"] --> fw
  fw --> lb`;
    const spec = mermaidToDiagramSpec(mmd);
    expect(spec!.nodes.find(n => n.id === "fw")!.group).toBe("dmz");
    expect(spec!.nodes.find(n => n.id === "inet")!.group).toBeUndefined();
  });

  it("returns null for invalid input", () => {
    expect(mermaidToDiagramSpec("not a graph")).toBeNull();
    expect(mermaidToDiagramSpec("")).toBeNull();
  });
});

describe("diagramSpecToMermaid", () => {
  it("converts spec back to Mermaid", () => {
    const spec = mermaidToDiagramSpec(`graph TD
  A["Start"] --> B["End"]`);
    const mmd = diagramSpecToMermaid(spec!);
    expect(mmd).toContain("graph TD");
    expect(mmd).toContain("Start");
    expect(mmd).toContain("End");
    expect(mmd).toContain("-->");
  });
});

describe("diagramSpecToYaml", () => {
  it("converts spec to YAML string", () => {
    const spec = mermaidToDiagramSpec(`graph LR
  A("Input") --> B["Process"] --> C("Output")`);
    const yaml = diagramSpecToYaml(spec!);
    expect(yaml).toContain("type: flowchart");
    expect(yaml).toContain("direction: LR");
    expect(yaml).toContain("id: A");
    expect(yaml).toContain("shape: rounded_rect");
    expect(yaml).toContain("from: A");
    expect(yaml).toContain("to: B");
  });
});
