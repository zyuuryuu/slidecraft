/**
 * figure-dropped-notice.test.ts — #391: two ```diagram (or a ```diagram + a flowchart ```mermaid,
 * which graduates to the SAME `diagram` field) on one slide used to keep only the LAST figure and
 * silently discard the earlier one. The "last wins" behavior itself is unchanged here (side-by-side
 * placement is a separate issue); this locks that the drop is REPORTED — a `figure-dropped`
 * ParseNotice at parse time, surfaced by get_deck_issues the same way #148's `table-dropped` is.
 */
import { describe, it, expect } from "vitest";
import { parseMd, parseMdReport } from "../src/engine/md-parser";
import { parseNoticesToIssues, REVIEW_RULES } from "../src/engine/deck-diagnostics";
import { parseTemplateSpecResponse } from "../src/engine/template-spec-prompts";
import { writeTemplate } from "../src/engine/template-writer";
import * as S from "../src/mcp/session";

const DIAG_A = "```diagram\nnodes:\n  - id: a1\n    label: A1\n```";
const DIAG_B = "```diagram\nnodes:\n  - id: b1\n    label: B1\n```";
const MERMAID_FLOW = "```mermaid\nflowchart LR\n  m1 --> m2\n```";

async function defaultTemplateBytes(): Promise<Uint8Array> {
  const spec = parseTemplateSpecResponse("{}");
  if (!spec.ok) throw new Error("default spec parse failed");
  return writeTemplate(spec.spec);
}

describe("parseMdReport — figure-dropped ParseNotice (#391)", () => {
  it("fires once when a 2nd ```diagram overwrites the 1st (last still wins)", () => {
    const { deck, notices } = parseMdReport(`# T\n\n${DIAG_A}\n\n${DIAG_B}`);
    expect(notices).toEqual([{ slideIndex: 0, kind: "figure-dropped" }]);
    expect(deck.slides[0].diagram?.yaml).toContain("b1"); // unchanged: the LAST figure survives
    expect(deck.slides[0].diagram?.yaml).not.toContain("a1");
  });

  it("fires when a flowchart ```mermaid (→ diagram) follows a ```diagram", () => {
    const { notices } = parseMdReport(`# T\n\n${DIAG_A}\n\n${MERMAID_FLOW}`);
    expect(notices).toEqual([{ slideIndex: 0, kind: "figure-dropped" }]);
  });

  it("fires once per overwritten figure (3 diagrams → 2 notices)", () => {
    const { notices } = parseMdReport(`# T\n\n${DIAG_A}\n\n${DIAG_B}\n\n${DIAG_A}`);
    expect(notices).toEqual([
      { slideIndex: 0, kind: "figure-dropped" },
      { slideIndex: 0, kind: "figure-dropped" },
    ]);
  });

  it("fires on the <!-- col --> path when two columns each hold a diagram", () => {
    const { notices } = parseMdReport(`# T\n\n<!-- col -->\n${DIAG_A}\n\n<!-- col -->\n${DIAG_B}`);
    expect(notices).toEqual([{ slideIndex: 0, kind: "figure-dropped" }]);
  });

  it("tags the correct slideIndex across multiple slides", () => {
    const { notices } = parseMdReport(`# 一\n\n- a\n\n---\n\n# 二\n\n${DIAG_A}\n\n${DIAG_B}`);
    expect(notices).toEqual([{ slideIndex: 1, kind: "figure-dropped" }]);
  });

  it("does NOT fire for a single-figure slide (byte-identical deck)", () => {
    const md = `# T\n\n- 本文\n\n${DIAG_A}`;
    const { deck, notices } = parseMdReport(md);
    expect(notices).toEqual([]);
    expect(deck).toEqual(parseMd(md));
  });

  it("does NOT fire for a single figure per column on the <!-- col --> path", () => {
    const { notices } = parseMdReport(`# T\n\n<!-- col -->\n- 本文\n\n<!-- col -->\n${DIAG_A}`);
    expect(notices).toEqual([]);
  });
});

describe("figure-dropped → DeckIssue (#391)", () => {
  it("parseNoticesToIssues maps it to a registered review rule id/level", () => {
    const deck = parseMd("# T\n\n- a");
    const [iss] = parseNoticesToIssues(deck, [{ kind: "figure-dropped", slideIndex: 0 }]);
    expect(iss.id).toBe("figure-dropped");
    const rule = REVIEW_RULES.find((r) => r.id === "figure-dropped");
    expect(rule).toBeDefined();
    expect(iss.level).toBe(rule!.level);
    expect(iss.slideIndex).toBe(0);
    expect(iss.message).toContain("図");
  });

  it("new_project → get_deck_issues surfaces it (and persists across reads)", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, await defaultTemplateBytes(), `# 図2つ\n\n${DIAG_A}\n\n${DIAG_B}`);
    expect(r.diagnostics.filter((x) => x.id === "figure-dropped")).toHaveLength(1);
    const issues = S.getDiagnostics(s).issues.filter((x) => x.id === "figure-dropped");
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(0);
  });
});
