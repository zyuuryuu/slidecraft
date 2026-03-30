import { describe, it, expect } from "vitest";
import {
  parseDiagramJson,
  validateDiagramSpec,
  diagnoseJson,
  resolveNodeStyle,
  groupDepth,
  groupChildren,
  groupAncestors,
  topLevelGroups,
  groupAllNodes,
  mergeNodeStyle,
  DiagramSpecSchema,
  type NodeStyle,
} from "../src/engine/schema";

// ── Sample data ──

const SAMPLE_FLOWCHART = JSON.stringify({
  type: "flowchart",
  direction: "TB",
  title: "認証フロー",
  classDefs: {
    process: { fill: "#1E2761", border: "#3B82F6", font_color: "#FFFFFF" },
    decision: { fill: "#F59E0B", font_color: "#1E293B" },
    terminal: { fill: "#3B82F6" },
  },
  nodes: [
    { id: "start", label: "開始", shape: "rounded_rect", class: "terminal" },
    { id: "proc1", label: "リクエスト受付", shape: "rect", class: "process" },
    { id: "auth", label: "認証OK？", shape: "diamond", class: "decision" },
    { id: "ok", label: "データ処理", shape: "rect", class: "process" },
    { id: "ng", label: "エラー返却", shape: "rect", class: "process" },
    { id: "end", label: "終了", shape: "rounded_rect", class: "terminal" },
  ],
  edges: [
    { from: "start", to: "proc1" },
    { from: "proc1", to: "auth" },
    { from: "auth", to: "ok", label: "Yes" },
    { from: "auth", to: "ng", label: "No" },
    { from: "ok", to: "end" },
    { from: "ng", to: "end" },
  ],
});

// ── Tests ──

describe("parseDiagramJson", () => {
  it("parses a valid flowchart", () => {
    const spec = parseDiagramJson(SAMPLE_FLOWCHART);
    expect(spec.type).toBe("flowchart");
    expect(spec.direction).toBe("TB");
    expect(spec.title).toBe("認証フロー");
    expect(spec.nodes).toHaveLength(6);
    expect(spec.edges).toHaveLength(6);
  });

  it("applies defaults for optional fields", () => {
    const minimal = JSON.stringify({
      type: "network",
      nodes: [{ id: "a", label: "A" }],
    });
    const spec = parseDiagramJson(minimal);
    expect(spec.direction).toBe("TB");
    expect(spec.edges).toEqual([]);
    expect(spec.groups).toEqual([]);
    expect(spec.lanes).toEqual([]);
    expect(spec.layout.node_width).toBe(2.0);
    expect(spec.layout.node_height).toBe(0.7);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseDiagramJson("{bad json")).toThrow();
  });

  it("throws on invalid type", () => {
    const bad = JSON.stringify({ type: "pie_chart", nodes: [] });
    expect(() => parseDiagramJson(bad)).toThrow();
  });

  it("throws on invalid direction", () => {
    const bad = JSON.stringify({ type: "flowchart", direction: "XY", nodes: [] });
    expect(() => parseDiagramJson(bad)).toThrow();
  });

  it("throws on invalid shape", () => {
    const bad = JSON.stringify({
      type: "flowchart",
      nodes: [{ id: "a", label: "A", shape: "trapezoid" }],
    });
    expect(() => parseDiagramJson(bad)).toThrow();
  });
});

describe("validateDiagramSpec", () => {
  it("returns empty for valid spec", () => {
    const spec = parseDiagramJson(SAMPLE_FLOWCHART);
    expect(validateDiagramSpec(spec)).toEqual([]);
  });

  it("detects unknown edge reference", () => {
    const data = {
      type: "flowchart" as const,
      direction: "TB" as const,
      nodes: [{ id: "a", label: "A", shape: "rect" as const }],
      edges: [{ from: "a", to: "nonexistent" }],
      classDefs: {},
      groups: [],
      lanes: [],
      layout: { node_width: 2, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
    };
    const errors = validateDiagramSpec(data);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("nonexistent");
  });

  it("detects duplicate node IDs", () => {
    const data = {
      type: "flowchart" as const,
      direction: "TB" as const,
      nodes: [
        { id: "a", label: "A", shape: "rect" as const },
        { id: "a", label: "B", shape: "rect" as const },
      ],
      edges: [],
      classDefs: {},
      groups: [],
      lanes: [],
      layout: { node_width: 2, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
    };
    const errors = validateDiagramSpec(data);
    expect(errors.some((e) => e.message.includes("Duplicate"))).toBe(true);
  });

  it("detects circular group nesting", () => {
    const data = {
      type: "flowchart" as const,
      direction: "TB" as const,
      nodes: [{ id: "n1", label: "N1", shape: "rect" as const }],
      edges: [],
      classDefs: {},
      groups: [
        { id: "g1", label: "G1", parent: "g2" },
        { id: "g2", label: "G2", parent: "g1" },
      ],
      lanes: [],
      layout: { node_width: 2, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
    };
    const errors = validateDiagramSpec(data);
    expect(errors.some((e) => e.message.includes("Circular"))).toBe(true);
  });

  it("detects self-referencing group", () => {
    const data = {
      type: "flowchart" as const,
      direction: "TB" as const,
      nodes: [],
      edges: [],
      classDefs: {},
      groups: [{ id: "g1", label: "G1", parent: "g1" }],
      lanes: [],
      layout: { node_width: 2, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
    };
    const errors = validateDiagramSpec(data);
    expect(errors.some((e) => e.message.includes("itself"))).toBe(true);
  });

  it("detects unknown classDef reference", () => {
    const data = {
      type: "flowchart" as const,
      direction: "TB" as const,
      nodes: [{ id: "a", label: "A", shape: "rect" as const, class: "nonexistent" }],
      edges: [],
      classDefs: {},
      groups: [],
      lanes: [],
      layout: { node_width: 2, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
    };
    const errors = validateDiagramSpec(data);
    expect(errors.some((e) => e.message.includes("unknown class"))).toBe(true);
  });

  it("detects unknown lane reference", () => {
    const data = {
      type: "flowchart" as const,
      direction: "TB" as const,
      nodes: [{ id: "a", label: "A", shape: "rect" as const, lane: "missing_lane" }],
      edges: [],
      classDefs: {},
      groups: [],
      lanes: [],
      layout: { node_width: 2, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
    };
    const errors = validateDiagramSpec(data);
    expect(errors.some((e) => e.message.includes("unknown lane"))).toBe(true);
  });
});

describe("diagnoseJson", () => {
  it("detects invalid JSON", () => {
    const issues = diagnoseJson("{bad");
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("error");
    expect(issues[0].message).toContain("Invalid JSON");
  });

  it("detects non-object root", () => {
    const issues = diagnoseJson("[1,2,3]");
    expect(issues[0].message).toContain("Expected a JSON object");
  });

  it("detects missing required fields", () => {
    const issues = diagnoseJson(JSON.stringify({ direction: "TB" }));
    expect(issues.some((i) => i.message.includes("'type'") && i.message.includes("missing"))).toBe(true);
    expect(issues.some((i) => i.message.includes("'nodes'") && i.message.includes("missing"))).toBe(true);
  });

  it("detects unknown fields with suggestions", () => {
    const issues = diagnoseJson(JSON.stringify({
      type: "flowchart",
      nodes: [],
      nods: [],  // typo
    }));
    const typoIssue = issues.find((i) => i.message.includes("nods"));
    expect(typoIssue).toBeDefined();
    expect(typoIssue!.suggestion).toBe("nodes");
  });

  it("detects invalid shape in node", () => {
    const issues = diagnoseJson(JSON.stringify({
      type: "flowchart",
      nodes: [{ id: "a", label: "A", shape: "triangle" }],
    }));
    expect(issues.some((i) => i.path.includes("shape") && i.message.includes("triangle"))).toBe(true);
  });

  it("returns empty for valid input", () => {
    const issues = diagnoseJson(SAMPLE_FLOWCHART);
    expect(issues).toEqual([]);
  });
});

describe("resolveNodeStyle", () => {
  it("returns classDef style when no per-node override", () => {
    const spec = parseDiagramJson(SAMPLE_FLOWCHART);
    const node = spec.nodes.find((n) => n.id === "start")!;
    const style = resolveNodeStyle(spec, node);
    expect(style.fill).toBe("#3B82F6"); // terminal classDef
  });

  it("merges per-node override with classDef", () => {
    const data = JSON.stringify({
      type: "flowchart",
      classDefs: { base: { fill: "#111111", font_color: "#FFFFFF" } },
      nodes: [{
        id: "n1", label: "N1", class: "base",
        style: { fill: "#222222" },  // override fill only
      }],
    });
    const spec = parseDiagramJson(data);
    const style = resolveNodeStyle(spec, spec.nodes[0]);
    expect(style.fill).toBe("#222222");   // overridden
    expect(style.font_color).toBe("#FFFFFF"); // from classDef
  });
});

describe("mergeNodeStyle", () => {
  it("prefers override non-default values", () => {
    const base: NodeStyle = {
      fill: "#111",
      border_width: 1.5,
      border_dash: false,
      font_color: "#FFFFFF",
      font_size: 11,
      font_bold: true,
    };
    const override: NodeStyle = {
      fill: "#222",
      border_width: 3,
      border_dash: false,
      font_color: "#FFFFFF",
      font_size: 11,
      font_bold: true,
    };
    const merged = mergeNodeStyle(base, override);
    expect(merged.fill).toBe("#222");
    expect(merged.border_width).toBe(3);
  });
});

describe("group helpers", () => {
  const GROUPED = JSON.stringify({
    type: "flowchart",
    nodes: [
      { id: "n1", label: "N1", group: "g1" },
      { id: "n2", label: "N2", group: "g2" },
      { id: "n3", label: "N3", group: "g1" },
    ],
    groups: [
      { id: "g1", label: "G1" },
      { id: "g2", label: "G2", parent: "g1" },
    ],
  });

  it("groupDepth returns correct depth", () => {
    const spec = parseDiagramJson(GROUPED);
    expect(groupDepth(spec, "g1")).toBe(0);
    expect(groupDepth(spec, "g2")).toBe(1);
  });

  it("groupChildren returns direct children", () => {
    const spec = parseDiagramJson(GROUPED);
    expect(groupChildren(spec, "g1")).toEqual(["g2"]);
    expect(groupChildren(spec, "g2")).toEqual([]);
  });

  it("groupAncestors returns ancestor chain", () => {
    const spec = parseDiagramJson(GROUPED);
    expect(groupAncestors(spec, "g2")).toEqual(["g1"]);
    expect(groupAncestors(spec, "g1")).toEqual([]);
  });

  it("topLevelGroups returns groups without parent", () => {
    const spec = parseDiagramJson(GROUPED);
    const top = topLevelGroups(spec);
    expect(top).toHaveLength(1);
    expect(top[0].id).toBe("g1");
  });

  it("groupAllNodes returns all nodes recursively", () => {
    const spec = parseDiagramJson(GROUPED);
    const all = groupAllNodes(spec, "g1");
    expect(all.sort()).toEqual(["n1", "n2", "n3"]);
  });
});
