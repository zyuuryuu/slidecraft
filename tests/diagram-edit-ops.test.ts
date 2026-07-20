/**
 * diagram-edit-ops.test.ts — the deterministic field-merge for diagram content edits (ADR-0019, P1).
 * Pins: only named fields change (zero drift on untouched), skips are reported never-silently,
 * add/remove work, and the merged YAML is a valid DiagramSpec (the adoption gate will accept it).
 */
import { describe, it, expect } from "vitest";
import * as yaml from "js-yaml";
import type { SlideIR } from "../src/engine/slide-schema";
import { applyDiagramEditOps, parseDiagramEditOps, checkDeleteIntent, buildOpsRetryInstruction } from "../src/engine/diagram-edit-ops";
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

  it("a no-op ops batch returns the slide byte-identical (no spurious re-dump / false -0+1 diff)", () => {
    // applyToFigure re-dumps via yaml.dump (not formatting-identical), so a pure no-op would otherwise
    // yield a figure string that differs by a line. dirty-tracking must return the ORIGINAL slide.
    const input = slide();
    const rmGhost = applyDiagramEditOps(input, [{ op: "removeNode", id: "ghost" }]);
    expect(rmGhost.slide).toBe(input); // reference-identical → figureFence(before)===figureFence(after)
    expect(rmGhost.skipped).toHaveLength(1); // …and the miss is still reported
    // nodeUpdate to the SAME value / setDirection to the SAME direction are no-ops too
    expect(applyDiagramEditOps(input, [{ op: "nodeUpdate", id: "db", label: "Database" }]).slide).toBe(input);
    expect(applyDiagramEditOps(input, [{ op: "setDirection", direction: "TB" }]).slide).toBe(input);
    expect(applyDiagramEditOps(input, [{ op: "removeEdge", from: "x", to: "y" }]).slide).toBe(input);
  });

  it("a REAL edit returns a NEW slide (dirty tracking doesn't over-suppress)", () => {
    const input = slide();
    expect(applyDiagramEditOps(input, [{ op: "nodeUpdate", id: "db", label: "PostgreSQL" }]).slide).not.toBe(input);
    expect(applyDiagramEditOps(input, [{ op: "removeNode", id: "db" }]).slide).not.toBe(input); // removes node + dangling edge
    expect(applyDiagramEditOps(input, [{ op: "setDirection", direction: "LR" }]).slide).not.toBe(input);
  });

  it("unknown removeNode / removeEdge skip messages list the candidates (never a bare miss)", () => {
    // L3: the ops-path adoption gate must be as informative as the Markdown path's.
    const rmNode = applyDiagramEditOps(slide(), [{ op: "removeNode", id: "ghost" }]).skipped;
    expect(rmNode[0].message).toContain("候補:");
    expect(rmNode[0].message).toContain("db"); // the ids that DO exist
    const rmEdge = applyDiagramEditOps(slide(), [{ op: "removeEdge", from: "x", to: "y" }]).skipped;
    expect(rmEdge[0].message).toMatch(/候補:.*a→db/); // the edges that DO exist
  });
});

// L2 (delete-safety, ADR-0019): a weak model told to delete a NON-existent element may hallucinate the
// nearest existing one (observed: "Cacheを削除" → removeEdge api→redis). checkDeleteIntent flags a
// delete whose target isn't referenced by the instruction — advisory-only, surfaced at the adoption gate.
describe("checkDeleteIntent — mistargeted-deletion advisory", () => {
  // A figure mirroring the on-device repro: web→api→db plus a redis node + api→redis edge.
  const REPRO = `type: flowchart
nodes:
  - id: web
    label: Webサーバー
  - id: api
    label: APIゲートウェイ 1200req/s
  - id: db
    label: Database
  - id: redis
    label: Redis
edges:
  - from: web
    to: api
  - from: api
    to: db
  - from: api
    to: redis
`;

  it("flags a removeEdge whose endpoints the instruction never names (the redis-for-cache misfire)", () => {
    const adv = checkDeleteIntent(slide(REPRO), [{ op: "removeEdge", from: "api", to: "redis" }], "存在しない Cache を削除");
    expect(adv).toHaveLength(1);
    expect(adv[0].op).toBe("removeEdge");
    expect(adv[0].message).toContain("Redis"); // names what it would delete
  });

  it("stays silent when the delete target IS named — by label or by id", () => {
    expect(checkDeleteIntent(slide(REPRO), [{ op: "removeNode", id: "redis" }], "Redis を削除")).toEqual([]); // label
    expect(checkDeleteIntent(slide(REPRO), [{ op: "removeNode", id: "redis" }], "redis ノードを消して")).toEqual([]); // id
    expect(checkDeleteIntent(slide(REPRO), [{ op: "removeEdge", from: "api", to: "db" }], "API から Database のエッジを削除")).toEqual([]);
  });

  it("flags a removeNode not referenced; single-char ids don't mask the miss", () => {
    expect(checkDeleteIntent(slide(), [{ op: "removeNode", id: "a" }], "Cache を削除")).toHaveLength(1); // id 'a' must NOT substring-match "cache"
    expect(checkDeleteIntent(slide(REPRO), [{ op: "removeNode", id: "db" }], "Cache を削除")).toHaveLength(1);
  });

  it("never fires on non-delete ops, empty instruction, or a figureless slide", () => {
    expect(checkDeleteIntent(slide(REPRO), [{ op: "nodeUpdate", id: "db", label: "X" }, { op: "addNode", id: "n", label: "N" }], "何かして")).toEqual([]);
    expect(checkDeleteIntent(slide(REPRO), [{ op: "removeNode", id: "redis" }], "   ")).toEqual([]);
    expect(checkDeleteIntent({ layout: "auto", placeholders: [] }, [{ op: "removeNode", id: "redis" }], "Redis を削除")).toEqual([]);
  });

  it("word-boundary: a short ASCII id is NOT 'referenced' by an unrelated longer word (FN fix)", () => {
    const s = slide(`type: flowchart\nnodes:\n  - id: sql\n    label: 生SQL実行モジュール\n  - id: pg\n    label: PostgreSQL 15\nedges:\n  - from: sql\n    to: pg\n`);
    // deletes 'sql' although the user named PostgreSQL (=pg). 'sql' is a substring of 'postgresql' but not a word.
    expect(checkDeleteIntent(s, [{ op: "removeNode", id: "sql" }], "PostgreSQL 15 を削除")).toHaveLength(1);
    expect(checkDeleteIntent(s, [{ op: "removeNode", id: "sql" }], "生SQL実行モジュールを削除")).toEqual([]); // named directly → silent
  });

  it("hyphen vs space name the same target → no spurious advisory (FP fix)", () => {
    const s = slide(`type: flowchart\nnodes:\n  - id: svc\n    label: Auth-Service\n  - id: x\n    label: X\nedges:\n  - from: x\n    to: svc\n`);
    expect(checkDeleteIntent(s, [{ op: "removeNode", id: "svc" }], "Auth Service を削除")).toEqual([]);
    expect(checkDeleteIntent(s, [{ op: "removeNode", id: "svc" }], "Auth-Service を削除")).toEqual([]);
  });

  it("English/romaji instructions that DO name the target stay silent (no word-fusion false positive)", () => {
    const s = slide(); // ids a, db; labels Start, Database
    // "db" bordered by spaces is a real reference — folding separators to empty would fuse the sentence
    // and embed "db" inside a letter run, wrongly firing the advisory.
    expect(checkDeleteIntent(s, [{ op: "removeNode", id: "db" }], "remove the db node")).toEqual([]);
    expect(checkDeleteIntent(s, [{ op: "removeNode", id: "db" }], "please delete db")).toEqual([]);
    expect(checkDeleteIntent(s, [{ op: "removeEdge", from: "a", to: "db" }], "delete the a to db edge")).toEqual([]);
    // and it STILL fires when the name is only an embedded substring (regression guard for the D fix)
    expect(checkDeleteIntent(slide(`type: flowchart\nnodes:\n  - id: sql\n    label: SQL\n  - id: pg\n    label: PG\nedges:\n  - from: sql\n    to: pg\n`),
      [{ op: "removeNode", id: "sql" }], "delete postgresql")).toHaveLength(1);
  });
});

// ADR-0019 ① Option A: the deterministic ops-bias nudge used to auto-retry ONCE when a figure edit
// drifted to full-Markdown. Harness-authored: it lists the real node ids and forbids full-Markdown.
describe("buildOpsRetryInstruction — ops-bias self-repair nudge", () => {
  it("restates the instruction, lists the real node ids, and forbids full-Markdown", () => {
    const n = buildOpsRetryInstruction(slide(), "API の後ろに Redis を追加");
    expect(n).toContain("API の後ろに Redis を追加"); // the original instruction is kept
    expect(n).toMatch(/既存ノードid:.*\ba\b/); // node ids from the figure (a, db)
    expect(n).toContain("db");
    expect(n).toMatch(/形式B|ops JSON 配列/); // steers to (B) ops
    expect(n).toMatch(/全文 ?Markdown は返さない/); // and away from (A)
  });
  it("degrades gracefully on a figureless slide (no ids)", () => {
    const n = buildOpsRetryInstruction({ layout: "auto", placeholders: [] }, "直して");
    expect(n).toContain("直して");
    expect(n).toContain("（なし）");
  });
});

// A figure that EXISTS but can't be parsed (schema-invalid) must never silently swallow an edit.
describe("applyDiagramEditOps — unparseable figure is reported, not silently dropped", () => {
  it("a schema-invalid figure (numeric id) → all ops skipped as 'unparseable-figure', slide unchanged", () => {
    const bad: SlideIR = { layout: "auto", placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "図" }] }] }],
      diagram: { placeholderIdx: "1", yaml: `type: flowchart\nnodes:\n  - id: 1\n    label: One\n  - id: 2\n    label: Two\nedges:\n  - from: 1\n    to: 2\n` } };
    const { slide: out, skipped } = applyDiagramEditOps(bad, [{ op: "nodeUpdate", id: "1", label: "Uno" }]);
    expect(out).toBe(bad); // unchanged (can't parse to mutate)…
    expect(skipped).toHaveLength(1); // …but NOT silent
    expect(skipped[0].reason).toBe("unparseable-figure");
  });
});

// Sequence figures index activations/fragments into the message (edge) list; removals must rebase those
// indices and drop refs to removed messages/participants (else orphan/out-of-range refs corrupt the render).
describe("applyDiagramEditOps — sequence removals rebase activations/fragments", () => {
  const SEQ = `type: sequence
nodes:
  - id: A
    label: User
  - id: B
    label: API
  - id: C
    label: DB
edges:
  - from: A
    to: B
  - from: B
    to: C
  - from: C
    to: B
  - from: B
    to: A
activations:
  - participant: B
    from: 1
    to: 3
fragments:
  - kind: loop
    label: retry
    from: 2
    to: 3
    dividers:
      - at: 2
        label: ""
notes:
  - text: session note
    placement: over
    participants: [A, B]
    at: 1
  - text: trailing note
    placement: left_of
    participants: [A]
    at: 4
`;
  const seqSlide = (): SlideIR => ({ layout: "auto", placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "図" }] }] }], diagram: { placeholderIdx: "1", yaml: SEQ } });
  type Seq = {
    edges?: unknown[];
    activations?: Array<{ participant: string; from: number; to: number }>;
    fragments?: Array<{ from: number; to: number; dividers?: Array<{ at: number }> }>;
    notes?: Array<{ text: string; placement: string; participants: string[]; at: number }>;
  };
  const loadSeq = (s: SlideIR): Seq => yaml.load(s.diagram!.yaml) as Seq;

  it("removeEdge shifts indices → activations/fragments are re-based to the surviving messages", () => {
    const { slide: out } = applyDiagramEditOps(seqSlide(), [{ op: "removeEdge", from: "A", to: "B" }]); // old index 0 removed
    const d = loadSeq(out);
    expect(d.activations).toEqual([{ participant: "B", from: 0, to: 2 }]); // 1→0, 3→2
    expect(d.fragments![0]).toMatchObject({ from: 1, to: 2 }); // 2→1, 3→2
    expect(d.fragments![0].dividers![0].at).toBe(1); // at 2→1
    expect(validateDiagramSource(out.diagram!.yaml, "yaml")).toBeNull(); // still valid
  });

  it("removeEdge also re-bases notes' `at`, including the trailing 'after last message' sentinel (#270)", () => {
    const { slide: out } = applyDiagramEditOps(seqSlide(), [{ op: "removeEdge", from: "A", to: "B" }]); // old index 0 removed
    const d = loadSeq(out);
    expect(d.notes).toEqual([
      { text: "session note", placement: "over", participants: ["A", "B"], at: 0 }, // 1→0
      { text: "trailing note", placement: "left_of", participants: ["A"], at: 3 }, // sentinel 4 (old edges.length) → 3 (new edges.length)
    ]);
    expect(validateDiagramSource(out.diagram!.yaml, "yaml")).toBeNull();
  });

  it("removeNode drops the orphan participant activation AND fragments spanning removed messages", () => {
    const { slide: out } = applyDiagramEditOps(seqSlide(), [{ op: "removeNode", id: "B" }]); // B is in every message + activation
    const d = loadSeq(out);
    expect(d.edges).toHaveLength(0);
    expect(d.activations).toEqual([]); // participant B gone
    expect(d.fragments).toEqual([]); // referenced removed messages
    expect(validateDiagramSource(out.diagram!.yaml, "yaml")).toBeNull();
  });

  it("removeNode drops notes referencing the removed participant, keeps the rest re-based (#270)", () => {
    const { slide: out } = applyDiagramEditOps(seqSlide(), [{ op: "removeNode", id: "B" }]); // B is a participant of the "over A,B" note
    const d = loadSeq(out);
    expect(d.notes).toEqual([{ text: "trailing note", placement: "left_of", participants: ["A"], at: 0 }]); // all 4 messages removed → sentinel 4→0
    expect(validateDiagramSource(out.diagram!.yaml, "yaml")).toBeNull();
  });
});
