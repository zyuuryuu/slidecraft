/**
 * sequence-diagram.test.ts — Native sequence diagrams (a second diagram engine:
 * temporal lifelines + ordered messages), rendered as PPTX objects, not images.
 * Milestone 1: participants, lifelines, sync/return messages, parser.
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema } from "../src/engine/schema";
import { computeSequenceLayout } from "../src/engine/diagram-sequence";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { mermaidToDiagramSpec } from "../src/engine/mermaid-to-diagram";
import { parseMd } from "../src/engine/md-parser";

const SPEC = DiagramSpecSchema.parse({
  type: "sequence",
  direction: "TB",
  nodes: [{ id: "A", label: "User" }, { id: "B", label: "API" }, { id: "C", label: "DB" }],
  edges: [
    { from: "A", to: "B", label: "request" },
    { from: "B", to: "C", label: "query" },
    { from: "C", to: "B", label: "rows", style: { dash: true } },
    { from: "B", to: "A", label: "response", style: { dash: true } },
  ],
});

describe("sequence layout + rendering (milestone 1)", () => {
  it("lays out participants across the top, messages ordered top→bottom", () => {
    const lay = computeSequenceLayout(SPEC, 0.8);
    expect(lay.parts.map((p) => p.id)).toEqual(["A", "B", "C"]);
    // participants spread horizontally (increasing centre x)
    expect(lay.parts[1].cx).toBeGreaterThan(lay.parts[0].cx);
    // messages ordered by edge order (increasing y)
    expect(lay.msgs).toHaveLength(4);
    expect(lay.msgs[1].y).toBeGreaterThan(lay.msgs[0].y);
    expect(lay.msgs[2].dash).toBe(true); // return message
  });

  it("renders participant boxes + lifelines + message arrows (native, not an image)", () => {
    const svg = renderDiagramToSvg(SPEC, {});
    expect(svg).toContain("User");
    expect(svg).toContain("API");
    expect(svg).toContain("request");
    expect(svg).toContain("response");
    // 3 lifelines + 4 messages → several line/path elements
    expect((svg.match(/<line|<path/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});

describe("Mermaid sequenceDiagram parser", () => {
  const MMD = `sequenceDiagram
  participant A as User
  participant B as API
  A->>B: request
  B-->>A: response`;

  it("parses participants + messages (dashed for -->>)", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    expect(spec.type).toBe("sequence");
    expect(spec.nodes.map((n) => n.label)).toEqual(["User", "API"]);
    expect(spec.edges[0]).toMatchObject({ from: "A", to: "B", label: "request" });
    expect(spec.edges[1].style?.dash).toBe(true); // -->> is a dashed return
  });

  it("a ```mermaid sequenceDiagram graduates to an editable .diagram on parse", () => {
    const s = parseMd("# Seq\n\n```mermaid\n" + MMD + "\n```\n").slides[0];
    expect(s.diagram).toBeDefined();
    expect(s.mermaidBlock).toBeUndefined();
    expect(s.diagram!.yaml).toContain("sequence");
  });
});

describe("sequence fragments (alt/loop/opt) — milestone 2", () => {
  const MMD = `sequenceDiagram
  participant A as User
  participant B as API
  A->>B: login
  alt valid
    B-->>A: token
  else invalid
    B-->>A: error
  end`;

  it("parses an alt block into a fragment over its message range", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    expect(spec.fragments).toHaveLength(1);
    expect(spec.fragments[0]).toMatchObject({ kind: "alt", label: "valid", from: 1, to: 2 });
  });

  it("renders the fragment box + kind/label tab", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    expect(computeSequenceLayout(spec, 0.8).frags).toHaveLength(1);
    const svg = renderDiagramToSvg(spec, {});
    expect(svg).toMatch(/>alt</);
    expect(svg).toContain("valid");
  });

  it("loop and opt are recognised too", () => {
    const spec = mermaidToDiagramSpec(`sequenceDiagram
  participant A
  participant B
  loop every minute
    A->>B: poll
  end`)!;
    expect(spec.fragments[0].kind).toBe("loop");
  });
});
