/**
 * col-table-dropped-notice.test.ts — #412: a `<!-- col -->` slide whose columns EACH hold a GFM table
 * kept only the LAST column's table (SlideIR carries one `table`) and silently discarded the earlier
 * one — the column-path twin of #148's body-path `table-dropped`. The "last wins" behavior itself is
 * unchanged here (side-by-side tables need an IR extension, #392); this locks that the drop is
 * REPORTED — the same `table-dropped` ParseNotice, surfaced by get_deck_issues.
 */
import { describe, it, expect } from "vitest";
import { parseMd, parseMdReport } from "../src/engine/md-parser";
import { parseNoticesToIssues, REVIEW_RULES } from "../src/engine/deck-diagnostics";
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

describe("parseMdReport — table-dropped on the <!-- col --> path (#412)", () => {
  it("fires once when a later column's table overwrites an earlier column's (last still wins)", () => {
    const { deck, notices } = parseMdReport(REPRO);
    expect(notices).toEqual([{ slideIndex: 0, kind: "table-dropped" }]);
    // unchanged: the LAST column's table survives at its column idx
    expect(deck.slides[0].table).toEqual({ rows: [["c", "d"], ["3", "4"]], header: true, placeholderIdx: "2" });
  });

  it("fires once per overwritten table (3 table columns → 2 notices)", () => {
    const third = "\n\n<!-- col -->\n| e | f |\n|---|---|\n| 5 | 6 |";
    const { notices } = parseMdReport(REPRO + third);
    expect(notices).toEqual([
      { slideIndex: 0, kind: "table-dropped" },
      { slideIndex: 0, kind: "table-dropped" },
    ]);
  });

  it("tags the correct slideIndex across multiple slides", () => {
    const { notices } = parseMdReport(`# 一\n\n- a\n\n---\n\n${REPRO}`);
    expect(notices).toEqual([{ slideIndex: 1, kind: "table-dropped" }]);
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

describe("table-dropped (col path) → DeckIssue (#412)", () => {
  it("maps to the registered rule; the message is accurate for the col path too", () => {
    const { deck, notices } = parseMdReport(REPRO);
    const [iss] = parseNoticesToIssues(deck, notices);
    expect(iss.id).toBe("table-dropped");
    expect(iss.level).toBe(REVIEW_RULES.find((r) => r.id === "table-dropped")!.level);
    expect(iss.slideIndex).toBe(0);
    // In a col slide the LAST column's table is the one kept — the message must not claim otherwise.
    expect(iss.message).toContain("<!-- col -->");
    expect(iss.message).toContain("最後の列の表");
  });

  it("new_project → get_deck_issues surfaces it (and persists across reads)", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, await defaultTemplateBytes(), REPRO);
    expect(r.diagnostics.filter((x) => x.id === "table-dropped")).toHaveLength(1);
    const issues = S.getDiagnostics(s).issues.filter((x) => x.id === "table-dropped");
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(0);
  });
});
