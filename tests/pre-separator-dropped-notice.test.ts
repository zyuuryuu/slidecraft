/**
 * pre-separator-dropped-notice.test.ts — #451: body written BEFORE the first separator comment
 * (`<!-- col -->` / kpi / step / card / compare / before) is dropped by splitBySeparator with no
 * ParseNotice（パーサが検出した欠落の通知）and no diagnostic — a no-silent-drop violation. The drop
 * itself is unchanged here (treating that text as column 1 is a separate oversight call, #451 案 2);
 * this locks that the drop is REPORTED — a new `pre-separator-dropped` ParseNotice, surfaced as a
 * warn DeckIssue (same channel as #148's `table-dropped`). Written before the fix (R3).
 */
import { describe, it, expect } from "vitest";
import { parseMd, parseMdReport } from "../src/engine/md-parser";
import { parseNoticesToIssues, REVIEW_RULES } from "../src/engine/deck-diagnostics";
import { parseTemplateSpecResponse } from "../src/engine/template-spec-prompts";
import { writeTemplate } from "../src/engine/template-writer";
import * as S from "../src/mcp/session";

// The issue's repro, verbatim: 「左A」「左B」 are dropped (only 右C survives as column 1).
const REPRO = "# 比較\n\n- 左A\n- 左B\n\n<!-- col -->\n\n- 右C";

// The correct spelling of the same slide: a separator BEFORE the first column too.
const CORRECT = "# 比較\n\n<!-- col -->\n\n- 左A\n- 左B\n\n<!-- col -->\n\n- 右C";

async function defaultTemplateBytes(): Promise<Uint8Array> {
  const spec = parseTemplateSpecResponse("{}");
  if (!spec.ok) throw new Error("default spec parse failed");
  return writeTemplate(spec.spec);
}

describe("parseMdReport — pre-separator-dropped (#451)", () => {
  it("fires once on the issue's repro; the parsed IR itself is unchanged (placement stays)", () => {
    const { deck, notices } = parseMdReport(REPRO);
    expect(notices).toEqual([{ slideIndex: 0, kind: "pre-separator-dropped", detail: "col" }]);
    // unchanged drop behavior: title + the post-separator column only
    expect(deck.slides[0].placeholders.map((p) => p.idx)).toEqual(["15", "1"]);
    expect(deck).toEqual(parseMd(REPRO)); // the notices side-channel doesn't change the parsed IR
  });

  it.each(["kpi", "step", "card", "compare"] as const)("fires for <!-- %s --> too", (kind) => {
    const { notices } = parseMdReport(`# T\n\n- 消える\n\n<!-- ${kind} -->\n\n- 残る`);
    expect(notices).toEqual([{ slideIndex: 0, kind: "pre-separator-dropped", detail: kind }]);
  });

  it("fires for the before/after family (detail carries the family type)", () => {
    const { notices } = parseMdReport("# T\n\n- 消える\n\n<!-- before -->\n\n- 旧\n\n<!-- after -->\n\n- 新");
    expect(notices).toEqual([{ slideIndex: 0, kind: "pre-separator-dropped", detail: "beforeAfter" }]);
  });

  it("tags the correct slideIndex across multiple slides", () => {
    const { notices } = parseMdReport(`# 一\n\n- a\n\n---\n\n${REPRO}`);
    expect(notices).toEqual([{ slideIndex: 1, kind: "pre-separator-dropped", detail: "col" }]);
  });
});

describe("pre-separator-dropped — negative side: a correctly written deck stays silent (#451)", () => {
  it("leading <!-- col --> before the first column → no notices, identical IR", () => {
    const { deck, notices } = parseMdReport(CORRECT);
    expect(notices).toEqual([]);
    expect(deck.slides[0].placeholders.map((p) => p.idx)).toEqual(["15", "1", "2"]);
    expect(deck).toEqual(parseMd(CORRECT));
  });

  it("blank lines before the first separator are not 本文 — no notice", () => {
    const { notices } = parseMdReport("# T\n\n\n<!-- col -->\n\n- a\n\n<!-- col -->\n\n- b");
    expect(notices).toEqual([]);
  });

  it("title / subtitle / field row / backdrop image before the first separator are consumed, not dropped — no notice", () => {
    // The image must be a SAFE data: src (isSafeImageSrc) — a remote src falls through to body text
    // and would then be legitimately reported as dropped.
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=";
    const md = `# T\n\n> サブタイトル\n\nSource: 出典\n\n![bg](${PNG})\n\n<!-- col -->\n\n- a\n\n<!-- col -->\n\n- b`;
    const { deck, notices } = parseMdReport(md);
    expect(notices).toEqual([]);
    expect(deck.slides[0].image).toBeDefined();
  });

  it("a slide with no separators never fires (standard parse path untouched)", () => {
    const { notices } = parseMdReport("# T\n\n- 本文のみ");
    expect(notices).toEqual([]);
  });
});

describe("pre-separator-dropped → DeckIssue (#451)", () => {
  it("is registered as a warn rule and maps with a message naming the separator", () => {
    const rule = REVIEW_RULES.find((r) => r.id === "pre-separator-dropped");
    expect(rule).toBeDefined();
    expect(rule!.level).toBe("warn");
    const { deck, notices } = parseMdReport(REPRO);
    const [iss] = parseNoticesToIssues(deck, notices);
    expect(iss.id).toBe("pre-separator-dropped");
    expect(iss.level).toBe("warn");
    expect(iss.slideIndex).toBe(0);
    expect(iss.title).toBe("比較");
    expect(iss.message).toContain("<!-- col -->");
  });

  it("the before/after family's message names <!-- before -->, not the internal family name", () => {
    const { deck, notices } = parseMdReport("# T\n\n- 消える\n\n<!-- before -->\n\n- 旧\n\n<!-- after -->\n\n- 新");
    const [iss] = parseNoticesToIssues(deck, notices);
    expect(iss.message).toContain("<!-- before -->");
    expect(iss.message).not.toContain("beforeAfter");
  });

  it("new_project → get_deck_issues surfaces it (and persists across reads)", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, await defaultTemplateBytes(), REPRO);
    expect(r.diagnostics.filter((x) => x.id === "pre-separator-dropped")).toHaveLength(1);
    const issues = S.getDiagnostics(s).issues.filter((x) => x.id === "pre-separator-dropped");
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(0);
    expect(issues[0].level).toBe("warn");
  });

  it("new_project on the correct spelling → zero pre-separator-dropped diagnostics", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, await defaultTemplateBytes(), CORRECT);
    expect(r.diagnostics.filter((x) => x.id === "pre-separator-dropped")).toHaveLength(0);
  });
});
