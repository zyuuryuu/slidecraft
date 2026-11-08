/**
 * chart-edit-ops.test.ts — #106 P3 / ADR-0019: DATA ops (table cells, chart series values, gantt
 * tasks, KPI cards). The model emits only the changed cell/value as a bare JSON array; the engine
 * writes it into the slide's EXISTING representation (`slide.table.rows`, the figure's raw YAML via
 * applyToFigure) — no second representation. Pinned here:
 *   (a) only the named cell/value changes; everything else stays byte-identical
 *   (b) R8 agreement: ops ≡ the same edit made in the slide's full Markdown and re-parsed (parseMd)
 *   (c) never-silent: a missing target is skipped + announced; a malformed array falls back + announced
 *   parse: whole-string bare array only, disjoint from the setField / figure / design vocabularies
 */
import { describe, it, expect } from "vitest";
import type { SlideIR } from "../src/engine/slide-schema";
import { parseMd } from "../src/engine/md-parser";
import {
  parseDataEditOps,
  applyDataEditOps,
  malformedDataOpsNotice,
  routeDataEdit,
  describeEditableData,
} from "../src/engine/chart-edit-ops";
import { parseFieldEditOps } from "../src/engine/field-edit-ops";
import { parseDiagramEditOps } from "../src/engine/diagram-edit-ops";
import { parseDesignIntent } from "../src/engine/design-intent";
import { DiagramSpecSchema, type DiagramSpec } from "../src/engine/schema";
import { loadYaml } from "../src/engine/yaml-io";
import * as yaml from "js-yaml";

/** Parse a one-slide Markdown deck (the GUI Markdown editor's write: handleSlideMdChange → parseMd). */
const md1 = (md: string): SlideIR => parseMd(md).slides[0];

/** The figure as the renderer sees it (schema-parsed DiagramSpec). */
const specOf = (s: SlideIR): DiagramSpec => DiagramSpecSchema.parse(loadYaml(s.diagram!.yaml));
/** A one-figure slide; `body` is the figure YAML. */
const figMd = (body: string): string => `# グラフ\n\n\`\`\`diagram\n${body}\n\`\`\``;

// ── Table (setCell) ──

const TABLE_MD = ["# 売上表", "", "| 項目 | 2025 | 2026 |", "| --- | --- | --- |", "| 売上 | 100 | 120 |", "| 利益 | 10 | 15 |"].join("\n");

describe("parseDataEditOps — setCell", () => {
  it("accepts a whole-string bare array (optionally fenced)", () => {
    expect(parseDataEditOps('[{"op":"setCell","row":1,"col":2,"text":"130"}]')).toEqual([{ op: "setCell", row: 1, col: 2, text: "130" }]);
    expect(parseDataEditOps('```json\n[{"op":"setCell","row":0,"col":0,"text":"区分"}]\n```')).toEqual([{ op: "setCell", row: 0, col: 0, text: "区分" }]);
  });
  it("rejects prose, Markdown, empty arrays and the other ops vocabularies", () => {
    expect(parseDataEditOps('例: [{"op":"setCell","row":1,"col":2,"text":"x"}] のように')).toBeNull();
    expect(parseDataEditOps("# 表\n| a |")).toBeNull();
    expect(parseDataEditOps("[]")).toBeNull();
    expect(parseDataEditOps('[{"op":"setField","idx":"15","text":"x"}]')).toBeNull();
    expect(parseDataEditOps('[{"op":"nodeUpdate","id":"a","label":"B"}]')).toBeNull();
    expect(parseDataEditOps('[{"op":"regionSplit","arrangement":"text-left"}]')).toBeNull();
  });
  it("a setCell array is not mistaken for setField / figure / design ops (vocabularies stay disjoint)", () => {
    const raw = '[{"op":"setCell","row":1,"col":2,"text":"130"}]';
    expect(parseFieldEditOps(raw)).toBeNull();
    expect(parseDiagramEditOps(raw)).toBeNull();
    expect(parseDesignIntent(raw)).toBeNull();
  });
});

describe("applyDataEditOps — setCell", () => {
  const slide = md1(TABLE_MD);

  it("(a) only the named cell changes; other rows are the SAME arrays, placeholders untouched", () => {
    const { slide: out, skipped } = applyDataEditOps(slide, [{ op: "setCell", row: 1, col: 2, text: "130" }]);
    expect(skipped).toEqual([]);
    expect(out.table!.rows).toEqual([["項目", "2025", "2026"], ["売上", "100", "130"], ["利益", "10", "15"]]);
    expect(out.table!.rows[0]).toBe(slide.table!.rows[0]);
    expect(out.table!.rows[2]).toBe(slide.table!.rows[2]);
    expect(out.placeholders).toBe(slide.placeholders);
    expect(out.table!.header).toBe(slide.table!.header);
    expect(out.table!.placeholderIdx).toBe(slide.table!.placeholderIdx);
  });
  it("row 0 is the header row (rows are addressed as stored in slide.table.rows)", () => {
    const { slide: out } = applyDataEditOps(slide, [{ op: "setCell", row: 0, col: 0, text: "区分" }]);
    expect(out.table!.rows[0]).toEqual(["区分", "2025", "2026"]);
  });
  it("does not mutate the input slide", () => {
    const before = JSON.stringify(slide);
    applyDataEditOps(slide, [{ op: "setCell", row: 1, col: 1, text: "x" }]);
    expect(JSON.stringify(slide)).toBe(before);
  });

  const cases: Array<[string, { row: number; col: number; text: string }, string]> = [
    ["a body value", { row: 1, col: 2, text: "130" }, "| 売上 | 100 | 130 |"],
    ["the header cell", { row: 0, col: 1, text: "前年" }, "| 項目 | 前年 | 2026 |"],
    ["a cell containing a pipe", { row: 2, col: 0, text: "利益|率" }, "| 利益\\|率 | 10 | 15 |"],
    ["surrounding whitespace (trimmed, as splitRow trims)", { row: 1, col: 2, text: " 130 " }, "| 売上 | 100 |  130  |"],
  ];
  for (const [name, op, editedLine] of cases) {
    it(`(b) R8: setCell ≡ editing the GFM table in the slide Markdown — ${name}`, () => {
      const lines = TABLE_MD.split("\n");
      const line = 2 + (op.row === 0 ? 0 : op.row + 1); // header is line 2, separator 3, body from 4
      lines[line] = editedLine;
      const direct = md1(lines.join("\n"));
      const viaOps = applyDataEditOps(slide, [{ op: "setCell", ...op }]);
      expect(viaOps.skipped).toEqual([]);
      expect(viaOps.slide.table).toEqual(direct.table);
      expect(viaOps.slide.placeholders).toEqual(direct.placeholders);
    });
  }

  it("(c) out-of-range row/col is skipped and announced with the table size; the rest still applies", () => {
    const { slide: out, skipped } = applyDataEditOps(slide, [
      { op: "setCell", row: 3, col: 0, text: "x" },
      { op: "setCell", row: 1, col: 5, text: "x" },
      { op: "setCell", row: 1, col: 1, text: "110" },
    ]);
    expect(skipped.map((s) => s.reason)).toEqual(["out-of-range", "out-of-range"]);
    expect(skipped[0].message).toMatch(/3 行 × 3 列/);
    expect(out.table!.rows[1]).toEqual(["売上", "110", "120"]);
  });
  it("(c) a slide without a table: every setCell is skipped, the ORIGINAL slide object is returned", () => {
    const plain = md1("# 見出し\n\n- a");
    const out = applyDataEditOps(plain, [{ op: "setCell", row: 0, col: 0, text: "x" }]);
    expect(out.slide).toBe(plain);
    expect(out.skipped[0].reason).toBe("no-table");
    expect(out.skipped[0].message).toMatch(/表/);
  });
  it("(c) a multi-line cell text cannot be expressed in a GFM table → skipped and announced", () => {
    const out = applyDataEditOps(slide, [{ op: "setCell", row: 1, col: 0, text: "売\n上" }]);
    expect(out.slide).toBe(slide);
    expect(out.skipped[0].reason).toBe("multiline-cell");
  });
  it("(b)(c) R8: a row made entirely of `-` cells re-parses as a separator in Markdown → skipped as unrepresentable", () => {
    // The Markdown path: the edited row is read as a separator, so the table ends at the header.
    const lines = TABLE_MD.split("\n");
    lines[4] = "| - | - | - |";
    expect(md1(lines.join("\n")).table?.rows ?? []).not.toEqual([["項目", "2025", "2026"], ["-", "-", "-"], ["利益", "10", "15"]]);
    // The ops path refuses the write that would turn the row into a separator (never silently).
    const { slide: out, skipped } = applyDataEditOps(slide, [
      { op: "setCell", row: 1, col: 0, text: "-" },
      { op: "setCell", row: 1, col: 1, text: ":---:" },
      { op: "setCell", row: 1, col: 2, text: " -- " },
    ]);
    expect(skipped.map((s) => s.reason)).toEqual(["unrepresentable-cell"]);
    expect(skipped[0].message).toMatch(/row 1, col 2/);
    expect(out.table!.rows[1]).toEqual(["-", ":---:", "120"]);
    const head = applyDataEditOps(md1("# t\n\n| a |\n| --- |\n| b |"), [{ op: "setCell", row: 0, col: 0, text: "---" }]);
    expect(head.skipped.map((s) => s.reason)).toEqual(["unrepresentable-cell"]);
  });
  it("a setCell that writes the same text is not a change (original slide returned)", () => {
    expect(applyDataEditOps(slide, [{ op: "setCell", row: 1, col: 1, text: "100" }]).slide).toBe(slide);
  });
});

describe("malformedDataOpsNotice / routeDataEdit — never-silent fallback", () => {
  const slide = md1(TABLE_MD);
  it("flags a bare array naming a DATA op that fails the schema (missing field / mixed vocabularies)", () => {
    expect(malformedDataOpsNotice('[{"op":"setCell","row":1,"col":2}]')).toMatch(/全文/);
    expect(malformedDataOpsNotice('[{"op":"setCell","row":-1,"col":0,"text":"x"}]')).toMatch(/全文/);
    expect(malformedDataOpsNotice('[{"op":"setCell","row":1,"col":2,"text":"x"},{"op":"nodeUpdate","id":"a"}]')).toMatch(/全文/);
  });
  it("is null for valid DATA ops, Markdown, prose and other vocabularies", () => {
    expect(malformedDataOpsNotice('[{"op":"setCell","row":1,"col":2,"text":"x"}]')).toBeNull();
    expect(malformedDataOpsNotice("# 表")).toBeNull();
    expect(malformedDataOpsNotice('[{"op":"setField","idx":"1"}]')).toBeNull();
  });
  it("routeDataEdit: ops → merged slide + notices; malformed → fallback; else null", () => {
    const r = routeDataEdit(slide, '[{"op":"setCell","row":1,"col":2,"text":"130"},{"op":"setCell","row":9,"col":0,"text":"x"}]');
    expect(r?.kind).toBe("ops");
    if (r?.kind !== "ops") return;
    expect(r.slide.table!.rows[1][2]).toBe("130");
    expect(r.notices).toHaveLength(1);
    expect(routeDataEdit(slide, '[{"op":"setCell","row":1}]')?.kind).toBe("fallback");
    expect(routeDataEdit(slide, '[{"op":"setField","idx":"1","text":"x"}]')).toBeNull();
    expect(routeDataEdit(slide, "# 表")).toBeNull();
  });
});

describe("describeEditableData — the table listing handed to the model", () => {
  it("lists every row with its index (row 0 = header)", () => {
    const d = describeEditableData(md1(TABLE_MD));
    expect(d).toMatch(/setCell/);
    expect(d).toMatch(/row 0 = header/);
    expect(d).toContain('- row 0: ["項目","2025","2026"]');
    expect(d).toContain('- row 2: ["利益","10","15"]');
  });
  it("is empty for a slide without a table or chart", () => {
    expect(describeEditableData(md1("# 見出し\n\n- a"))).toBe("");
  });
});

// ── Chart series (setSeriesValue: xychart / radar) ──

const XY = ["type: xychart", "nodes: []", "xychart:", "  categories: [Q1, Q2, Q3]", "  series:", "    - kind: bar", "      name: 売上", "      values: [10, 20, 30]", "    - kind: line", "      name: 利益", "      values: [1, 2, 3]"].join("\n");
const RADAR = ["type: radar", "nodes: []", "radar:", "  axes: [速度, 品質, 価格]", "  max: 5", "  series:", "    - name: 自社", "      values: [4, 5, 3]", "    - name: 競合", "      values: [3, 3, 5]"].join("\n");

describe("applyDataEditOps — setSeriesValue", () => {
  it("parses with the series named by 0-based index or by name", () => {
    expect(parseDataEditOps('[{"op":"setSeriesValue","series":0,"index":1,"value":25}]')).toEqual([{ op: "setSeriesValue", series: 0, index: 1, value: 25 }]);
    expect(parseDataEditOps('[{"op":"setSeriesValue","series":"利益","index":2,"value":3.5}]')).toEqual([{ op: "setSeriesValue", series: "利益", index: 2, value: 3.5 }]);
    expect(parseDataEditOps('[{"op":"setSeriesValue","series":0,"index":1,"value":"25"}]')).toBeNull(); // value must be a number
  });

  const cases: Array<[string, string, Record<string, unknown>, [string, string]]> = [
    ["xychart by index", XY, { series: 0, index: 1, value: 25 }, ["values: [10, 20, 30]", "values: [10, 25, 30]"]],
    ["xychart by name", XY, { series: "利益", index: 2, value: 3.5 }, ["values: [1, 2, 3]", "values: [1, 2, 3.5]"]],
    ["radar by name", RADAR, { series: "競合", index: 0, value: 4 }, ["values: [3, 3, 5]", "values: [4, 3, 5]"]],
  ];
  for (const [name, body, op, [from, to]] of cases) {
    it(`(b) R8: setSeriesValue ≡ editing the figure YAML in the slide Markdown — ${name}`, () => {
      const slide = md1(figMd(body));
      const direct = md1(figMd(body.replace(from, to)));
      const viaOps = applyDataEditOps(slide, [{ op: "setSeriesValue", ...op } as never]);
      expect(viaOps.skipped).toEqual([]);
      expect(specOf(viaOps.slide)).toEqual(specOf(direct));
      expect(viaOps.slide.placeholders).toBe(slide.placeholders);
      expect(viaOps.slide.diagram!.placeholderIdx).toBe(slide.diagram!.placeholderIdx);
    });
  }

  it("(a) on a canonically dumped figure only the edited value's line changes (rest byte-identical)", () => {
    const canon = yaml.dump(loadYaml(XY), { lineWidth: 1000 });
    const slide: SlideIR = { layout: "auto", placeholders: [], diagram: { yaml: canon, placeholderIdx: "1" } };
    const out = applyDataEditOps(slide, [{ op: "setSeriesValue", series: 1, index: 0, value: 7 }]).slide.diagram!.yaml;
    const a = canon.split("\n");
    const b = out.split("\n");
    expect(b.length).toBe(a.length);
    expect(a.filter((l, i) => l !== b[i])).toEqual(["        - 1"]);
    expect(b.filter((l, i) => l !== a[i])).toEqual(["        - 7"]);
  });

  it("(c) unknown series / out-of-range index are skipped and announced with the candidates", () => {
    const slide = md1(figMd(XY));
    const { slide: out, skipped } = applyDataEditOps(slide, [
      { op: "setSeriesValue", series: "費用", index: 0, value: 1 },
      { op: "setSeriesValue", series: 2, index: 0, value: 1 },
      { op: "setSeriesValue", series: 0, index: 3, value: 1 },
    ]);
    expect(out).toBe(slide); // nothing applied → original slide (no spurious re-dump)
    expect(skipped.map((s) => s.reason)).toEqual(["unknown-series", "unknown-series", "out-of-range"]);
    expect(skipped[0].message).toContain("売上");
    expect(skipped[0].message).toContain("利益");
    expect(skipped[2].message).toMatch(/3 個/);
  });
  it("(c) a series name shared by several series (incl. two unnamed xychart series) is ambiguous → skipped", () => {
    const dup = md1(figMd(XY.replace("name: 利益", "name: 売上")));
    const r = applyDataEditOps(dup, [{ op: "setSeriesValue", series: "売上", index: 0, value: 9 }]);
    expect(r.slide).toBe(dup);
    expect(r.skipped.map((s) => s.reason)).toEqual(["ambiguous-series"]);
    expect(r.skipped[0].message).toMatch(/2 件/);
    const unnamed = md1(figMd(XY.replace("      name: 売上\n", "").replace("      name: 利益\n", "")));
    const u = applyDataEditOps(unnamed, [{ op: "setSeriesValue", series: "", index: 0, value: 9 }]);
    expect(u.slide).toBe(unnamed);
    expect(u.skipped.map((s) => s.reason)).toEqual(["ambiguous-series"]);
    // addressing by index still works for unnamed series
    expect(specOf(applyDataEditOps(unnamed, [{ op: "setSeriesValue", series: 1, index: 0, value: 9 }]).slide).xychart!.series[1].values).toEqual([9, 2, 3]);
  });
  it("(c) a slide whose figure is not an xychart/radar (or has no figure) skips and announces", () => {
    const flow = md1(figMd("type: flowchart\nnodes:\n  - id: a\n    label: A"));
    expect(applyDataEditOps(flow, [{ op: "setSeriesValue", series: 0, index: 0, value: 1 }]).skipped[0].reason).toBe("no-chart");
    const plain = md1("# 見出し");
    const r = applyDataEditOps(plain, [{ op: "setSeriesValue", series: 0, index: 0, value: 1 }]);
    expect(r.slide).toBe(plain);
    expect(r.skipped[0].reason).toBe("no-chart");
    // the notice tells "no figure at all" apart from "a figure of another type"
    expect(r.skipped[0].message).toMatch(/図がない/);
    expect(applyDataEditOps(flow, [{ op: "setSeriesValue", series: 0, index: 0, value: 1 }]).skipped[0].message).toMatch(/xychart/);
  });
  it("(c) a figure that fails the schema is skipped as unparseable (never silently dropped)", () => {
    const bad = md1(figMd(XY.replace("nodes: []\n", "")));
    const r = applyDataEditOps(bad, [{ op: "setSeriesValue", series: 0, index: 0, value: 1 }]);
    expect(r.slide).toBe(bad);
    expect(r.skipped[0].reason).toBe("unparseable-figure");
  });
  it("a table op and a series op in one reply both apply (one DATA kind per reply)", () => {
    const md = `${TABLE_MD}\n\n\`\`\`diagram\n${XY}\n\`\`\``;
    const slide = md1(md);
    const { slide: out, skipped } = applyDataEditOps(slide, [
      { op: "setCell", row: 1, col: 1, text: "101" },
      { op: "setSeriesValue", series: 0, index: 0, value: 11 },
    ]);
    expect(skipped).toEqual([]);
    expect(out.table!.rows[1][1]).toBe("101");
    expect(specOf(out).xychart!.series[0].values).toEqual([11, 20, 30]);
  });
  it("describeEditableData lists categories/axes and each series with its index", () => {
    const d = describeEditableData(md1(figMd(XY)));
    expect(d).toMatch(/setSeriesValue/);
    expect(d).toContain('categories: ["Q1","Q2","Q3"]');
    expect(d).toContain('- series 0 "売上": [10,20,30]');
    expect(d).toContain('- series 1 "利益": [1,2,3]');
    expect(describeEditableData(md1(figMd(RADAR)))).toContain('axes: ["速度","品質","価格"]');
  });
});

// ── Gantt (setTask: keyed by task name — the schema's tasks carry no id) ──

const GANTT = ["type: gantt", "nodes: []", "gantt:", "  startDate: '2026-01-01'", "  tasks:", "    - name: 設計", "      section: 計画", "      start: 0", "      end: 10", "      status: done", "    - name: 実装", "      section: 開発", "      start: 10", "      end: 30", "      status: active"].join("\n");

describe("applyDataEditOps — setTask", () => {
  it("parses: name required, at least the named fields typed", () => {
    expect(parseDataEditOps('[{"op":"setTask","name":"実装","end":35}]')).toEqual([{ op: "setTask", name: "実装", end: 35 }]);
    expect(parseDataEditOps('[{"op":"setTask","end":35}]')).toBeNull();
    expect(parseDataEditOps('[{"op":"setTask","name":"実装","end":"35"}]')).toBeNull();
  });

  const cases: Array<[string, Record<string, unknown>, Array<[string, string]>]> = [
    ["extend the end", { name: "実装", end: 35 }, [["      end: 30", "      end: 35"]]],
    ["reschedule + status", { name: "設計", start: 2, end: 12, status: "crit" }, [["      start: 0", "      start: 2"], ["      end: 10", "      end: 12"], ["      status: done", "      status: crit"]]],
    ["rename + move section", { name: "実装", newName: "開発・結合", section: "結合" }, [["    - name: 実装", "    - name: 開発・結合"], ["      section: 開発", "      section: 結合"]]],
  ];
  for (const [name, op, edits] of cases) {
    it(`(b) R8: setTask ≡ editing the gantt YAML in the slide Markdown — ${name}`, () => {
      const slide = md1(figMd(GANTT));
      let body = GANTT;
      for (const [from, to] of edits) body = body.replace(from, to);
      const viaOps = applyDataEditOps(slide, [{ op: "setTask", ...op } as never]);
      expect(viaOps.skipped).toEqual([]);
      expect(specOf(viaOps.slide)).toEqual(specOf(md1(figMd(body))));
      expect(viaOps.slide.placeholders).toBe(slide.placeholders);
    });
  }
  it("(c) unknown / ambiguous task name and end < start are skipped and announced", () => {
    const dup = md1(figMd(GANTT.replace("    - name: 実装", "    - name: 設計")));
    expect(applyDataEditOps(dup, [{ op: "setTask", name: "設計", end: 5 }]).skipped[0].reason).toBe("ambiguous-task");
    const slide = md1(figMd(GANTT));
    const { slide: out, skipped } = applyDataEditOps(slide, [
      { op: "setTask", name: "テスト", end: 40 },
      { op: "setTask", name: "実装", end: 5 },
    ]);
    expect(out).toBe(slide);
    expect(skipped.map((s) => s.reason)).toEqual(["unknown-task", "invalid-range"]);
    expect(skipped[0].message).toContain("「設計」・「実装」");
    expect(applyDataEditOps(md1(figMd(XY)), [{ op: "setTask", name: "設計", end: 1 }]).skipped[0].reason).toBe("no-chart");
  });
  it("(c) newName colliding with another task's name is skipped and announced (would make the name ambiguous)", () => {
    const slide = md1(figMd(GANTT));
    const r = applyDataEditOps(slide, [{ op: "setTask", name: "実装", newName: "設計", end: 35 }]);
    expect(r.slide).toBe(slide);
    expect(r.skipped.map((s) => s.reason)).toEqual(["duplicate-task-name"]);
    expect(r.skipped[0].message).toContain("設計");
    // renaming a task to its own name is not a collision
    expect(applyDataEditOps(slide, [{ op: "setTask", name: "実装", newName: "実装", end: 35 }]).skipped).toEqual([]);
  });
  it("describeEditableData lists each task with its schedule (day offsets from startDate)", () => {
    const d = describeEditableData(md1(figMd(GANTT)));
    expect(d).toMatch(/setTask/);
    expect(d).toContain("2026-01-01");
    expect(d).toContain('- "設計": start 0, end 10, status "done", section "計画"');
  });
});

// ── KPI (setCard: the schema's card fields value / label / delta / trend) ──

const KPI = ["type: kpi", "nodes: []", "kpi:", "  cards:", "    - value: 120%", "      label: 前年比", "      delta: +5pt", "      trend: up", "    - value: 35社", "      label: 新規顧客"].join("\n");

describe("applyDataEditOps — setCard", () => {
  it("parses: index required; fields are the schema's card fields", () => {
    expect(parseDataEditOps('[{"op":"setCard","index":1,"value":"40社"}]')).toEqual([{ op: "setCard", index: 1, value: "40社" }]);
    expect(parseDataEditOps('[{"op":"setCard","value":"40社"}]')).toBeNull();
  });

  const cases: Array<[string, Record<string, unknown>, Array<[string, string]>]> = [
    ["change the big number", { index: 1, value: "40社" }, [["    - value: 35社", "    - value: 40社"]]],
    ["relabel + delta + trend", { index: 0, label: "前年同期比", delta: "-2pt", trend: "down" }, [["      label: 前年比", "      label: 前年同期比"], ["      delta: +5pt", "      delta: '-2pt'"], ["      trend: up", "      trend: down"]]],
  ];
  for (const [name, op, edits] of cases) {
    it(`(b) R8: setCard ≡ editing the kpi YAML in the slide Markdown — ${name}`, () => {
      const slide = md1(figMd(KPI));
      let body = KPI;
      for (const [from, to] of edits) body = body.replace(from, to);
      const viaOps = applyDataEditOps(slide, [{ op: "setCard", ...op } as never]);
      expect(viaOps.skipped).toEqual([]);
      expect(specOf(viaOps.slide)).toEqual(specOf(md1(figMd(body))));
      expect(viaOps.slide.placeholders).toBe(slide.placeholders);
    });
  }
  it("(c) out-of-range card / non-kpi figure are skipped and announced", () => {
    const slide = md1(figMd(KPI));
    const r = applyDataEditOps(slide, [{ op: "setCard", index: 2, value: "x" }]);
    expect(r.slide).toBe(slide);
    expect(r.skipped[0].reason).toBe("out-of-range");
    expect(r.skipped[0].message).toMatch(/2 枚/);
    expect(applyDataEditOps(md1(figMd(XY)), [{ op: "setCard", index: 0, value: "x" }]).skipped[0].reason).toBe("no-chart");
  });
  it("describeEditableData lists each card with its index", () => {
    const d = describeEditableData(md1(figMd(KPI)));
    expect(d).toMatch(/setCard/);
    expect(d).toContain('- card 0: value "120%", label "前年比", delta "+5pt", trend "up"');
    expect(d).toContain('- card 1: value "35社", label "新規顧客", delta "", trend ""');
  });
});
