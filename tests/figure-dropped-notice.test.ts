/**
 * figure-dropped-notice.test.ts — #391 → #392 段 1: two ```diagram (or a ```diagram + a flowchart ```mermaid,
 * which graduates to a diagram) on one slide used to keep only the LAST figure ("last wins") with a
 * `figure-dropped` ParseNotice. Since #392 段 1 the parser KEEPS every figure (SlideIR `figures`, the
 * singular `diagram` = the FIRST one), so there is no parse-time drop any more. What stays never-silent:
 * until #392 段 2 places a 2nd figure of one kind, no renderer draws it — deck-diagnostics reports that
 * under the same `figure-dropped` review rule, derived from the DeckIR (slide-figures.undrawnFigures).
 */
import { describe, it, expect } from "vitest";
import { parseMd, parseMdReport } from "../src/engine/md-parser";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";
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

describe("parseMdReport — a 2nd figure of one kind is KEPT, not dropped (#392 段 1)", () => {
  const issuesOf = (md: string) => diagnoseDeck(parseMd(md)).filter((x) => x.id === "figure-dropped");

  it("2 ```diagram → both kept in order (the 1st in `diagram`), no parse notice; diagnostics: 1 undrawn", () => {
    const { deck, notices } = parseMdReport(`# T\n\n${DIAG_A}\n\n${DIAG_B}`);
    expect(notices).toEqual([]);
    expect(deck.slides[0].diagram?.yaml).toContain("a1"); // the FIRST figure is the singular field now
    expect(deck.slides[0].figures?.map((f) => f.kind === "diagram" && f.yaml.includes("b1"))).toEqual([false, true]);
    expect(issuesOf(`# T\n\n${DIAG_A}\n\n${DIAG_B}`)).toHaveLength(1);
  });

  it("a flowchart ```mermaid (→ diagram) after a ```diagram is kept as the 2nd diagram", () => {
    const { deck, notices } = parseMdReport(`# T\n\n${DIAG_A}\n\n${MERMAID_FLOW}`);
    expect(notices).toEqual([]);
    expect(deck.slides[0].figures?.map((f) => f.kind)).toEqual(["diagram", "diagram"]);
  });

  it("3 diagrams → 3 kept; one issue per slide that counts the 2 undrawn ones", () => {
    const md = `# T\n\n${DIAG_A}\n\n${DIAG_B}\n\n${DIAG_A}`;
    expect(parseMd(md).slides[0].figures).toHaveLength(3);
    const iss = issuesOf(md);
    expect(iss).toHaveLength(1);
    expect(iss[0].message).toContain("図の2つ目以降（2個）");
  });

  it("the <!-- col --> path keeps one diagram per column at its column idx", () => {
    const { deck, notices } = parseMdReport(`# T\n\n<!-- col -->\n${DIAG_A}\n\n<!-- col -->\n${DIAG_B}`);
    expect(notices).toEqual([]);
    expect(deck.slides[0].figures?.map((f) => f.placeholderIdx)).toEqual(["1", "2"]);
  });

  it("tags the correct slideIndex across multiple slides", () => {
    expect(issuesOf(`# 一\n\n- a\n\n---\n\n# 二\n\n${DIAG_A}\n\n${DIAG_B}`).map((x) => x.slideIndex)).toEqual([1]);
  });

  it("nothing for a single-figure slide (byte-identical deck, no `figures`)", () => {
    const md = `# T\n\n- 本文\n\n${DIAG_A}`;
    const { deck, notices } = parseMdReport(md);
    expect(notices).toEqual([]);
    expect(deck).toEqual(parseMd(md));
    expect(deck.slides[0].figures).toBeUndefined();
    expect(issuesOf(md)).toEqual([]);
  });

  it("nothing for a single figure per column on the <!-- col --> path", () => {
    const md = `# T\n\n<!-- col -->\n- 本文\n\n<!-- col -->\n${DIAG_A}`;
    expect(parseMdReport(md).notices).toEqual([]);
    expect(issuesOf(md)).toEqual([]);
  });
});

describe("figure-dropped → DeckIssue (#391 → #392 段 1: derived from the DeckIR)", () => {
  it("diagnoseDeck maps it to the registered review rule id/level", () => {
    const [iss] = diagnoseDeck(parseMd(`# T\n\n${DIAG_A}\n\n${DIAG_B}`)).filter((x) => x.id === "figure-dropped");
    const rule = REVIEW_RULES.find((r) => r.id === "figure-dropped");
    expect(rule).toBeDefined();
    expect(iss.level).toBe(rule!.level);
    expect(iss.slideIndex).toBe(0);
    expect(iss.message).toContain("描画されません");
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
