/**
 * col-table-dropped-notice.test.ts — #412 → #392 段 1: a `<!-- col -->` slide whose columns EACH hold a GFM
 * table used to keep only the LAST column's table (SlideIR carried one `table`) with a `table-dropped`
 * ParseNotice. #392 段 1 extends the IR (`figures`): every column's table is KEPT at its column idx (the
 * singular `table` = the FIRST), so nothing is dropped at parse time. Never-silent stays: until #392 段 2
 * places a 2nd table, no renderer draws it — get_deck_issues reports that as `figure-dropped`.
 */
import { describe, it, expect } from "vitest";
import { parseMd, parseMdReport } from "../src/engine/md-parser";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { parseTemplateSpecResponse } from "../src/engine/template-spec-prompts";
import { writeTemplate } from "../src/engine/template-writer";
import * as S from "../src/mcp/session";

// The issue's repro, verbatim.
const REPRO = "# T\n\n<!-- col -->\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<!-- col -->\n| c | d |\n|---|---|\n| 3 | 4 |";

async function defaultTemplateBytes(): Promise<Uint8Array> {
  const spec = parseTemplateSpecResponse("{}");
  if (!spec.ok) throw new Error("default spec parse failed");
  return writeTemplate(spec.spec);
}

describe("parseMdReport — every column's table is kept on the <!-- col --> path (#412 → #392 段 1)", () => {
  it("2 table columns → both kept at their column idx (the 1st in `table`), no parse notice", () => {
    const { deck, notices } = parseMdReport(REPRO);
    expect(notices).toEqual([]);
    expect(deck.slides[0].table).toEqual({ rows: [["a", "b"], ["1", "2"]], header: true, placeholderIdx: "1" });
    expect(deck.slides[0].figures).toEqual([
      { kind: "table", rows: [["a", "b"], ["1", "2"]], header: true, placeholderIdx: "1" },
      { kind: "table", rows: [["c", "d"], ["3", "4"]], header: true, placeholderIdx: "2" },
    ]);
  });

  it("3 table columns → 3 kept", () => {
    const third = "\n\n<!-- col -->\n| e | f |\n|---|---|\n| 5 | 6 |";
    const { deck, notices } = parseMdReport(REPRO + third);
    expect(notices).toEqual([]);
    expect(deck.slides[0].figures?.map((f) => f.placeholderIdx)).toEqual(["1", "2", "3"]);
  });

  it("does NOT fire for col1 本文 | col2 表 (one table in the col slide) — IR unchanged", () => {
    const md = "# T\n\n<!-- col -->\n- 本文\n\n<!-- col -->\n| a | b |\n|---|---|\n| 1 | 2 |";
    const { deck, notices } = parseMdReport(md);
    expect(notices).toEqual([]);
    expect(deck).toEqual(parseMd(md)); // the notices side-channel doesn't change the parsed IR
    expect(deck.slides[0].table).toEqual({ rows: [["a", "b"], ["1", "2"]], header: true, placeholderIdx: "2" });
  });

  it("does NOT fire for col1 表 | col2 図 (one table + one figure)", () => {
    const md = "# T\n\n<!-- col -->\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<!-- col -->\n```diagram\nnodes:\n  - id: n1\n    label: N1\n```";
    expect(parseMdReport(md).notices).toEqual([]);
  });
});

describe("the not-yet-drawn 2nd table → DeckIssue (#392 段 1)", () => {
  it("diagnoseDeck reports it as figure-dropped on that slide (and no table-dropped)", () => {
    const issues = diagnoseDeck(parseMd(`# 一\n\n- a\n\n---\n\n${REPRO}`));
    expect(issues.filter((x) => x.id === "figure-dropped").map((x) => x.slideIndex)).toEqual([1]);
    expect(issues.filter((x) => x.id === "table-dropped")).toEqual([]);
  });

  it("new_project → get_deck_issues surfaces it (and persists across reads)", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, await defaultTemplateBytes(), REPRO);
    expect(r.diagnostics.filter((x) => x.id === "figure-dropped")).toHaveLength(1);
    const issues = S.getDiagnostics(s).issues.filter((x) => x.id === "figure-dropped");
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(0);
  });
});
