/**
 * sequence-diagram.test.ts — Native sequence diagrams (a second diagram engine:
 * temporal lifelines + ordered messages), rendered as PPTX objects, not images.
 * Milestone 1: participants, lifelines, sync/return messages, parser.
 */
import { describe, it, expect } from "vitest";
import { DiagramSpecSchema, validateDiagramSpec } from "../src/engine/schema";
import { computeSequenceLayout } from "../src/engine/diagram-sequence";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { mermaidToDiagramSpec, diagramSpecToMermaid } from "../src/engine/mermaid-to-diagram";
import { parseMd } from "../src/engine/md-parser";
import * as yaml from "js-yaml";

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
    const spec = DiagramSpecSchema.parse(yaml.load(s.diagram!.yaml));
    expect(spec.type).toBe("sequence");
    expect(spec.edges).toHaveLength(2);
    expect(spec.edges[1].style?.dash).toBe(true); // dashed return survives conversion
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

  it("the fragment survives parse→conversion (not dropped by serialization)", () => {
    const s = parseMd("# F\n\n```mermaid\n" + MMD + "\n```\n").slides[0];
    const spec = DiagramSpecSchema.parse(yaml.load(s.diagram!.yaml));
    expect(spec.fragments).toHaveLength(1);
    expect(spec.fragments[0]).toMatchObject({ kind: "alt", from: 1, to: 2 });
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

describe("sequence milestone 3 — else dividers / activations / async arrows", () => {
  const MMD = `sequenceDiagram
  participant U as User
  participant A as API
  U->>+A: login
  alt valid
    A-->>U: token
  else invalid
    A-->>-U: error
  end
  U-)A: fire-and-forget`;

  it("parses the alt `else` as a branch divider on the fragment", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    const alt = spec.fragments.find((f) => f.kind === "alt")!;
    expect(alt.dividers).toHaveLength(1);
    expect(alt.dividers[0]).toMatchObject({ label: "invalid" });
    expect(alt.dividers[0].at).toBe(2); // else starts at message index 2
  });

  it("parses +/- activation into an activation span on A", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    const act = spec.activations.find((a) => a.participant === "A")!;
    expect(act).toBeDefined();
    expect(act.from).toBe(0); // activated by the +login message
    expect(act.to).toBe(2); // deactivated by the -error message
  });

  it("marks an async `-)` message with style.async (open arrowhead)", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    const fire = spec.edges.find((e) => e.label === "fire-and-forget")!;
    expect(fire.style?.async).toBe(true);
    // sync messages are NOT async
    expect(spec.edges.find((e) => e.label === "login")?.style?.async).toBeFalsy();
  });

  it("renders the else divider, an activation bar, and an open arrowhead (native)", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    const lay = computeSequenceLayout(spec, 0.8);
    expect(lay.frags[0].dividers).toHaveLength(1);
    expect(lay.acts.length).toBeGreaterThan(0);
    const svg = renderDiagramToSvg(spec, {});
    expect(svg).toContain("invalid"); // divider label
    expect(svg).toMatch(/<polyline[^>]*fill="none"/); // open (line) arrowhead, not a filled polygon
  });

  it("M3 fields survive parse→conversion (not dropped by serialization)", () => {
    const s = parseMd("# M3\n\n```mermaid\n" + MMD + "\n```\n").slides[0];
    const spec = DiagramSpecSchema.parse(yaml.load(s.diagram!.yaml));
    expect(spec.fragments.find((f) => f.kind === "alt")?.dividers?.[0]?.label).toBe("invalid");
    expect(spec.activations.some((a) => a.participant === "A")).toBe(true);
    expect(spec.edges.find((e) => e.label === "fire-and-forget")?.style?.async).toBe(true);
  });
});

describe("sequence notes (Note over / left of / right of) — #270", () => {
  const MMD = `sequenceDiagram
  participant A as User
  participant B as API
  Note over A,B: session starts
  A->>B: login
  Note left of A: waiting…
  B-->>A: token
  Note right of B: token cached`;

  it("parses Note over A,B into a note spanning both participants, before message 0", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    expect(spec.notes).toHaveLength(3);
    expect(spec.notes[0]).toMatchObject({ text: "session starts", placement: "over", participants: ["A", "B"], at: 0 });
  });

  it("parses Note left of / right of a single participant, at their message position", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    expect(spec.notes[1]).toMatchObject({ text: "waiting…", placement: "left_of", participants: ["A"], at: 1 });
    expect(spec.notes[2]).toMatchObject({ text: "token cached", placement: "right_of", participants: ["B"], at: 2 });
  });

  it("an unknown participant reference is never-silent (validateDiagramSpec flags it, not dropped)", () => {
    const spec = mermaidToDiagramSpec(`sequenceDiagram
  participant A
  A->>A: ping
  Note over A,GHOST: who is this?`)!;
    // the note is preserved (not silently discarded) even though GHOST was never declared
    expect(spec.notes[0].participants).toEqual(["A", "GHOST"]);
    const errors = validateDiagramSpec(spec);
    expect(errors.some((e) => e.message.includes("unknown participant") && e.message.includes("GHOST"))).toBe(true);
  });

  it("does not regress plain sequence diagrams with no notes", () => {
    const spec = mermaidToDiagramSpec(`sequenceDiagram
  participant A
  participant B
  A->>B: hi`)!;
    expect(spec.notes).toEqual([]);
    expect(validateDiagramSpec(spec)).toEqual([]);
  });

  it("lays out an 'over' note spanning its participants and left_of/right_of beside a single lifeline", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    const lay = computeSequenceLayout(spec, 0.8);
    expect(lay.notes).toHaveLength(3);
    const [over, leftOf, rightOf] = lay.notes;
    const aCx = lay.parts.find((p) => p.id === "A")!.cx;
    const bCx = lay.parts.find((p) => p.id === "B")!.cx;
    // over: box spans between A and B's centre x
    expect(over.x).toBeLessThan(Math.min(aCx, bCx));
    expect(over.x + over.w).toBeGreaterThan(Math.max(aCx, bCx));
    // left_of: box sits to the left of A's lifeline
    expect(leftOf.x + leftOf.w).toBeLessThanOrEqual(aCx + 0.01);
    // right_of: box sits to the right of B's lifeline
    expect(rightOf.x).toBeGreaterThanOrEqual(bCx - 0.01);
    // notes get their own vertical slot — none of them collide with a message y
    for (const n of lay.notes) {
      for (const m of lay.msgs) expect(n.y).not.toBeCloseTo(m.y, 2);
    }
  });

  it("renders the note boxes + text natively (not an image)", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    const svg = renderDiagramToSvg(spec, {});
    expect(svg).toContain("session starts");
    expect(svg).toContain("waiting…");
    expect(svg).toContain("token cached");
  });

  it("round-trips through diagramSpecToMermaid (R8 agreement: write-back matches the parser)", () => {
    const spec = mermaidToDiagramSpec(MMD)!;
    const back = diagramSpecToMermaid(spec);
    const reparsed = mermaidToDiagramSpec(back)!;
    expect(reparsed.notes).toEqual(spec.notes);
    expect(reparsed.edges).toEqual(spec.edges);
  });

  it("notes survive parse→conversion into the editable .diagram YAML (not dropped by serialization)", () => {
    const s = parseMd("# N\n\n```mermaid\n" + MMD + "\n```\n").slides[0];
    expect(s.diagram).toBeDefined();
    const spec = DiagramSpecSchema.parse(yaml.load(s.diagram!.yaml));
    expect(spec.notes).toHaveLength(3);
    expect(spec.notes[0]).toMatchObject({ placement: "over", participants: ["A", "B"] });
  });
});
