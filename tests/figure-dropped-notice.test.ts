/**
 * figure-dropped-notice.test.ts — #391 → #392 段 1 → 段 2: two ```diagram (or a ```diagram + a flowchart ```mermaid,
 * which graduates to a diagram) on one slide used to keep only the LAST figure ("last wins") with a
 * `figure-dropped` ParseNotice. Since #392 段 1 the parser KEEPS every figure (SlideIR `figures`, the
 * singular `diagram` = the FIRST one), so there is no parse-time drop any more. Since #392 段 2 every figure
 * is placed in its own body region and DRAWN. What stays never-silent: a figure the resolved layout has
 * no region for is not drawn — deck-diagnostics reports that under the same `figure-dropped` review rule,
 * read off the SAME placement the export draws by (visual-placement.figureRegions). Needs the template's
 * layouts, like every other placement diagnostic.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { parseMd, parseMdReport } from "../src/engine/md-parser";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";
import { parseTemplateSpecResponse } from "../src/engine/template-spec-prompts";
import { writeTemplate } from "../src/engine/template-writer";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import * as S from "../src/mcp/session";

const DIAG_A = "```diagram\nnodes:\n  - id: a1\n    label: A1\n```";
const DIAG_B = "```diagram\nnodes:\n  - id: b1\n    label: B1\n```";
const MERMAID_FLOW = "```mermaid\nflowchart LR\n  m1 --> m2\n```";

async function defaultTemplateBytes(): Promise<Uint8Array> {
  const spec = parseTemplateSpecResponse("{}");
  if (!spec.ok) throw new Error("default spec parse failed");
  return writeTemplate(spec.spec);
}

// The default template has Chart.2Chart.Equal / Column.2Body.* / Column.3Body.Equal and the 1-body Content.1Body.Single.
let tpl: TemplateData;
beforeAll(async () => {
  tpl = await loadTemplate(await defaultTemplateBytes());
});
const PIN_ONE_BODY = "<!-- slide: Content.1Body.Single -->\n";

describe("parseMdReport — a 2nd figure of one kind is KEPT, not dropped (#392 段 1)", () => {
  const issuesOf = (md: string) => diagnoseDeck(parseMd(md), buildCatalog(tpl), tpl.layouts).filter((x) => x.id === "figure-dropped");

  it("2 ```diagram → both kept in order (the 1st in `diagram`), no parse notice; both drawn (段 2) → no issue", () => {
    const { deck, notices } = parseMdReport(`# T\n\n${DIAG_A}\n\n${DIAG_B}`);
    expect(notices).toEqual([]);
    expect(deck.slides[0].diagram?.yaml).toContain("a1"); // the FIRST figure is the singular field now
    expect(deck.slides[0].figures?.map((f) => f.kind === "diagram" && f.yaml.includes("b1"))).toEqual([false, true]);
    expect(issuesOf(`# T\n\n${DIAG_A}\n\n${DIAG_B}`)).toEqual([]);
  });

  it("2 ```diagram pinned to a 1-body layout → the 2nd has no region → 1 figure-dropped", () => {
    const iss = issuesOf(`${PIN_ONE_BODY}# T\n\n${DIAG_A}\n\n${DIAG_B}`);
    expect(iss).toHaveLength(1);
    expect(iss[0].message).toContain("図（1個）");
    expect(iss[0].message).toContain("Content.1Body.Single");
  });

  it("a flowchart ```mermaid (→ diagram) after a ```diagram is kept as the 2nd diagram", () => {
    const { deck, notices } = parseMdReport(`# T\n\n${DIAG_A}\n\n${MERMAID_FLOW}`);
    expect(notices).toEqual([]);
    expect(deck.slides[0].figures?.map((f) => f.kind)).toEqual(["diagram", "diagram"]);
  });

  it("3 diagrams → 3 kept and drawn (Column.3Body); pinned to 1 body → one issue per slide counting the 2 undrawn ones", () => {
    const md = `# T\n\n${DIAG_A}\n\n${DIAG_B}\n\n${DIAG_A}`;
    expect(parseMd(md).slides[0].figures).toHaveLength(3);
    expect(issuesOf(md)).toEqual([]);
    const iss = issuesOf(PIN_ONE_BODY + md);
    expect(iss).toHaveLength(1);
    expect(iss[0].message).toContain("図（2個）");
  });

  it("an image with no region is named too (2 images pinned to a 1-body layout)", () => {
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const iss = issuesOf(`${PIN_ONE_BODY}# T\n\n![a](${PNG})\n\n![b](${PNG})`);
    expect(iss).toHaveLength(1);
    expect(iss[0].message).toContain("画像（1個）");
  });

  it("4 diagrams → the 4th has no region even on the widest (3-column) layout → 1 undrawn", () => {
    const iss = issuesOf(`# T\n\n${DIAG_A}\n\n${DIAG_B}\n\n${DIAG_A}\n\n${DIAG_B}`);
    expect(iss).toHaveLength(1);
    expect(iss[0].message).toContain("図（1個）");
  });

  it("2-arg diagnoseDeck (no template) never reports it — the drop depends on the resolved layout", () => {
    expect(diagnoseDeck(parseMd(`${PIN_ONE_BODY}# T\n\n${DIAG_A}\n\n${DIAG_B}`)).filter((x) => x.id === "figure-dropped")).toEqual([]);
  });

  it("the <!-- col --> path keeps one diagram per column at its column idx", () => {
    const { deck, notices } = parseMdReport(`# T\n\n<!-- col -->\n${DIAG_A}\n\n<!-- col -->\n${DIAG_B}`);
    expect(notices).toEqual([]);
    expect(deck.slides[0].figures?.map((f) => f.placeholderIdx)).toEqual(["1", "2"]);
  });

  it("tags the correct slideIndex across multiple slides", () => {
    expect(issuesOf(`# 一\n\n- a\n\n---\n\n${PIN_ONE_BODY}# 二\n\n${DIAG_A}\n\n${DIAG_B}`).map((x) => x.slideIndex)).toEqual([1]);
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

describe("figure-dropped → DeckIssue (#391 → #392 段 2: derived from the placement on the resolved layout)", () => {
  it("diagnoseDeck maps it to the registered review rule id/level", () => {
    const [iss] = diagnoseDeck(parseMd(`${PIN_ONE_BODY}# T\n\n${DIAG_A}\n\n${DIAG_B}`), buildCatalog(tpl), tpl.layouts).filter((x) => x.id === "figure-dropped");
    const rule = REVIEW_RULES.find((r) => r.id === "figure-dropped");
    expect(rule).toBeDefined();
    expect(iss.level).toBe(rule!.level);
    expect(iss.slideIndex).toBe(0);
    expect(iss.message).toContain("描画されません");
  });

  it("new_project → get_deck_issues surfaces it (and persists across reads)", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, await defaultTemplateBytes(), `${PIN_ONE_BODY}# 図2つ\n\n${DIAG_A}\n\n${DIAG_B}`);
    expect(r.diagnostics.filter((x) => x.id === "figure-dropped")).toHaveLength(1);
    const issues = S.getDiagnostics(s).issues.filter((x) => x.id === "figure-dropped");
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(0);
  });
});
