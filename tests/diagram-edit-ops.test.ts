/**
 * diagram-edit-ops.test.ts — the deterministic field-merge for diagram content edits (ADR-0019, P1).
 * Pins: only named fields change (zero drift on untouched), skips are reported never-silently,
 * add/remove work, and the merged YAML is a valid DiagramSpec (the adoption gate will accept it).
 */
import { describe, it, expect } from "vitest";
import * as yaml from "js-yaml";
import type { SlideIR } from "../src/engine/slide-schema";
import { applyDiagramEditOps, parseDiagramEditOps } from "../src/engine/diagram-edit-ops";
import { validateDiagramSource } from "../src/engine/mermaid-to-diagram";

const DIAGRAM = `type: flowchart
direction: TB
nodes:
  - id: a
    label: Start
  - id: db
    label: Database
    value: 100
edges:
  - from: a
    to: db
    label: query
`;

const slide = (y = DIAGRAM): SlideIR => ({
  layout: "auto",
  placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "図" }] }] }],
  diagram: { yaml: y, placeholderIdx: "1" },
});

type LoadedDiagram = {
  direction?: string;
  nodes: Array<{ id: string; label: string; value?: number; shape?: string; sublabel?: string }>;
  edges?: Array<{ from: string; to: string; label?: string; relation?: string }>;
};
const load = (s: SlideIR): LoadedDiagram => yaml.load(s.diagram!.yaml) as LoadedDiagram;
const node = (d: LoadedDiagram, id: string) => d.nodes.find((n) => n.id === id);

describe("parseDiagramEditOps", () => {
  it("detects a bare JSON ops array (optionally ```-fenced)", () => {
    expect(parseDiagramEditOps('[{"op":"nodeUpdate","id":"db","label":"X"}]')).toEqual([{ op: "nodeUpdate", id: "db", label: "X" }]);
    expect(parseDiagramEditOps('```json\n[{"op":"setDirection","direction":"LR"}]\n```')).toEqual([{ op: "setDirection", direction: "LR" }]);
  });
  it("returns null for Markdown / prose-quoted / design ops / empty", () => {
    expect(parseDiagramEditOps("# 見出し\n\n- 箇条書き")).toBeNull();
    expect(parseDiagramEditOps("説明: 例 [{op:...}] のように書く")).toBeNull(); // quoted in prose, not whole-string
    expect(parseDiagramEditOps('[{"op":"regionSplit","arrangement":"text-left"}]')).toBeNull(); // design op ≠ diagram-edit op
    expect(parseDiagramEditOps("[]")).toBeNull();
  });
});

describe("applyDiagramEditOps — deterministic merge (zero drift on untouched fields)", () => {
  it("nodeUpdate changes ONLY the named field; other nodes/values/edges stay verbatim", () => {
    const { slide: out, skipped } = applyDiagramEditOps(slide(), [{ op: "nodeUpdate", id: "db", label: "PostgreSQL" }]);
    expect(skipped).toEqual([]);
    const d = load(out);
    expect(node(d, "db")!.label).toBe("PostgreSQL");
    expect(node(d, "db")!.value).toBe(100); // untouched value preserved
    expect(node(d, "a")!.label).toBe("Start"); // untouched node preserved
    expect(d.edges).toHaveLength(1);
    expect(d.edges![0].label).toBe("query"); // untouched edge preserved
    expect(d.direction).toBe("TB");
  });

  it("unknown node → skipped (never-silent), sibling ops still apply", () => {
    const { slide: out, skipped } = applyDiagramEditOps(slide(), [
      { op: "nodeUpdate", id: "ghost", label: "X" },
      { op: "nodeUpdate", id: "a", label: "開始" },
    ]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ op: "nodeUpdate", reason: "unknown-node" });
    expect(node(load(out), "a")!.label).toBe("開始");
  });

  it("addNode / addEdge append", () => {
    const { slide: out } = applyDiagramEditOps(slide(), [
      { op: "addNode", id: "cache", label: "Redis", shape: "cylinder" },
      { op: "addEdge", from: "db", to: "cache", label: "sync" },
    ]);
    const d = load(out);
    expect(node(d, "cache")!.shape).toBe("cylinder");
    expect(d.edges).toContainEqual(expect.objectContaining({ from: "db", to: "cache", label: "sync" }));
  });

  it("removeNode drops the node AND its now-dangling edges", () => {
    const { slide: out } = applyDiagramEditOps(slide(), [{ op: "removeNode", id: "db" }]);
    const d = load(out);
    expect(d.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(d.edges ?? []).toHaveLength(0);
  });

  it("edgeUpdate / removeEdge / setDirection", () => {
    expect(load(applyDiagramEditOps(slide(), [{ op: "edgeUpdate", from: "a", to: "db", label: "SELECT" }]).slide).edges![0].label).toBe("SELECT");
    expect(load(applyDiagramEditOps(slide(), [{ op: "setDirection", direction: "LR" }]).slide).direction).toBe("LR");
    expect(load(applyDiagramEditOps(slide(), [{ op: "removeEdge", from: "a", to: "db" }]).slide).edges ?? []).toHaveLength(0);
  });

  it("no-figure slide → all ops skipped, slide unchanged (identity)", () => {
    const noFig: SlideIR = { layout: "auto", placeholders: [] };
    const { slide: out, skipped } = applyDiagramEditOps(noFig, [{ op: "nodeUpdate", id: "a", label: "X" }]);
    expect(out).toBe(noFig);
    expect(skipped).toEqual([{ op: "nodeUpdate", reason: "no-figure", message: expect.any(String) }]);
  });

  it("merged result is a valid DiagramSpec (adoption gate accepts)", () => {
    const { slide: out } = applyDiagramEditOps(slide(), [
      { op: "nodeUpdate", id: "db", label: "PostgreSQL" },
      { op: "addNode", id: "c", label: "Cache" },
      { op: "addEdge", from: "db", to: "c" },
    ]);
    expect(validateDiagramSource(out.diagram!.yaml, "yaml")).toBeNull(); // null = valid
  });
});
