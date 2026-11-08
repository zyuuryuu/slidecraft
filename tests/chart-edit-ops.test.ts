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

/** Parse a one-slide Markdown deck (the GUI Markdown editor's write: handleSlideMdChange → parseMd). */
const md1 = (md: string): SlideIR => parseMd(md).slides[0];

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
