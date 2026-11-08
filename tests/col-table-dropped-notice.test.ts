/**
 * col-table-dropped-notice.test.ts — #412 → #392 段 1: a `<!-- col -->` slide whose columns EACH hold a GFM
 * table used to keep only the LAST column's table (SlideIR carried one `table`) with a `table-dropped`
 * ParseNotice. #392 段 1 extends the IR (`figures`): every column's table is KEPT at its column idx (the
 * singular `table` = the FIRST), so nothing is dropped at parse time. Since #392 段 2 the 2nd table is drawn
 * in its own column region, so get_deck_issues reports nothing; never-silent stays for a layout without a
 * region for it (`figure-dropped`, figure-dropped-notice.test.ts).
 */
import { describe, it, expect } from "vitest";
import { parseMd, parseMdReport } from "../src/engine/md-parser";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { parseTemplateSpecResponse } from "../src/engine/template-spec-prompts";
import { writeTemplate } from "../src/engine/template-writer";
import * as S from "../src/mcp/session";
import JSZip from "jszip";
import { loadTemplate } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";

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

describe("the 2nd table is drawn (#392 段 2) → no DeckIssue", () => {
  it("diagnoseDeck (with the template) reports neither figure-dropped nor table-dropped", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, await defaultTemplateBytes(), `# 一\n\n- a\n\n---\n\n${REPRO}`);
    expect(r.diagnostics.filter((x) => x.id === "figure-dropped" || x.id === "table-dropped")).toEqual([]);
    expect(S.getDiagnostics(s).issues.filter((x) => x.id === "figure-dropped")).toEqual([]);
    expect(diagnoseDeck(parseMd(`# 一\n\n- a\n\n---\n\n${REPRO}`)).filter((x) => x.id === "table-dropped")).toEqual([]);
  });

  it("the exported PPTX carries both tables", async () => {
    const tpl = await loadTemplate(await defaultTemplateBytes());
    const zip = await JSZip.loadAsync(await generatePptx(parseMd(REPRO), tpl));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml.match(/<a:tbl>/g)).toHaveLength(2);
    expect(xml).toContain(">c<");
  });
});
