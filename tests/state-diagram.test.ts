/**
 * state-diagram.test.ts — Native state diagrams (Mermaid stateDiagram → DiagramSpec
 * → editable PPTX shapes, not an image). States are rounded-rect nodes, `[*]` is a
 * start (solid dot) / end (ring) pseudo-state, transitions are labelled edges.
 */
import { describe, it, expect } from "vitest";
import { mermaidToDiagramSpec } from "../src/engine/mermaid-to-diagram";
import { diagramSpecToMermaid, canSerializeToMermaid } from "../src/engine/diagram-serialize";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { computeLayout } from "../src/engine/layout-engine";
import { parseMd } from "../src/engine/md-parser";

const MMD = `stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  Running --> Idle : stop
  Running --> [*] : done`;

describe("Mermaid stateDiagram parser", () => {
  it("maps states to rounded-rect nodes and [*] to start/end pseudo-states", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    expect(spec).not.toBeNull();
    expect(spec.nodes.find((n) => n.id === "Idle")?.shape).toBe("rounded_rect");
    expect(spec.nodes.some((n) => n.shape === "start")).toBe(true); // [*] as source
    expect(spec.nodes.some((n) => n.shape === "end")).toBe(true); // [*] as target
    expect(spec.edges.find((e) => e.to === "Running")?.label).toBe("start");
  });

  it("a ```mermaid stateDiagram graduates to an editable .diagram (not an image)", () => {
    const s = parseMd("# 状態\n\n```mermaid\n" + MMD + "\n```\n").slides[0];
    expect(s.diagram).toBeDefined();
    expect(s.mermaidBlock).toBeUndefined();
  });
});

describe("state diagram rendering", () => {
  it("renders state labels + start/end dots as native shapes", () => {
    const svg = renderDiagramToSvg(mermaidToDiagramSpec(MMD)!, {});
    expect(svg).toContain("Idle");
    expect(svg).toContain("Running");
    expect((svg.match(/<ellipse/g) ?? []).length).toBeGreaterThanOrEqual(3); // start dot + end ring (2)
  });

  it("sizes pseudo-states as small dots, smaller than states", () => {
    const pos = computeLayout(mermaidToDiagramSpec(MMD)!);
    const start = pos.find((p) => p.nodeId === "__start")!;
    expect(start.w).toBeLessThan(0.5);
    expect(start.h).toBeLessThan(0.5);
    expect(pos.find((p) => p.nodeId === "Idle")!.w).toBeGreaterThan(start.w);
  });
});

describe("state diagram round-trips through Mermaid", () => {
  it("spec → Mermaid → spec preserves states, transitions, pseudo-states", () => {
    const spec1 = mermaidToDiagramSpec(MMD)!;
    expect(canSerializeToMermaid(spec1)).toBe(true);
    const spec2 = mermaidToDiagramSpec(diagramSpecToMermaid(spec1))!;
    expect(spec2.nodes).toEqual(spec1.nodes);
    expect(spec2.edges).toEqual(spec1.edges);
  });

  it("custom state labels survive via `state \"Label\" as id`", () => {
    const spec1 = mermaidToDiagramSpec(`stateDiagram-v2
  state "実行中" as R
  [*] --> R
  R --> [*]`)!;
    const spec2 = mermaidToDiagramSpec(diagramSpecToMermaid(spec1))!;
    expect(spec2.nodes.find((n) => n.id === "R")?.label).toBe("実行中");
  });
});
