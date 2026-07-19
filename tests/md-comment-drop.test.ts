/**
 * md-comment-drop.test.ts — #147: non-directive HTML comment-only lines (review notes,
 * TODO markers, source IDs an upstream agent/human left in the Markdown) are dropped at
 * parse time and never render onto a slide. Directive comments (slide/col/kpi/step/card)
 * keep their behavior byte-identical, and fenced-block interiors stay verbatim.
 * Dropped comments do NOT round-trip (spec'd in #147 — the serializer never sees them).
 */

import { describe, it, expect } from "vitest";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import type { SlideIR, Paragraph } from "../src/engine/slide-schema";

/** Flatten a placeholder's paragraphs to plain-text lines (segments joined). */
function paraTexts(slide: SlideIR, idx: string): string[] {
  const ph = slide.placeholders.find((p) => p.idx === idx);
  return (ph?.paragraphs ?? []).map((p: Paragraph) => p.segments.map((s) => s.text).join(""));
}

describe("parseMd — comment-only line drop (#147)", () => {
  it("drops comment-only lines from the body (issue repro — acceptance criterion)", () => {
    const md = `# タイトル

<!-- REVIEW: この数字は要確認 [S01] -->
- 論点A <!-- inline note -->

<!-- TODO 出典を足す -->
- 論点B`;
    const s = parseMd(md).slides[0];
    // Comment-only lines vanish (together with the blank that only set them off);
    // the INLINE comment stays — stripping mid-line comments is out of scope for
    // the first cut (#147 fix 方針).
    expect(paraTexts(s, "1")).toEqual(["論点A <!-- inline note -->", "論点B"]);
  });

  it("keeps a blank paragraph when the comment had its own blank separation on both sides", () => {
    // The comment "paragraph" swallows only its LEADING blanks (markdown paragraph
    // removal); the blank after it still separates A from B as authored.
    const md = `# T

論点A

<!-- note -->

論点B`;
    expect(paraTexts(parseMd(md).slides[0], "1")).toEqual(["論点A", "", "論点B"]);
  });

  it("a comment-only line above the <!-- slide: --> directive no longer hides the layout pin", () => {
    const md = `<!-- REVIEW: レイアウト要確認 -->
<!-- slide: Content.1Body.Single -->
# タイトル

本文`;
    const s = parseMd(md).slides[0];
    expect(s.layout).toBe("Content.1Body.Single");
    expect(paraTexts(s, "1")).toEqual(["本文"]);
  });

  it("directive comments (slide/col/kpi/step/card) behave byte-identically with notes present", () => {
    const withNote = `<!-- slide: KPI.3Value.Equal -->
# Metrics

<!-- REVIEW: 数値は Q2 版に更新済みか？ -->
<!-- kpi -->
98.5%
Uptime

<!-- kpi -->
$2.4M
Revenue`;
    const withoutNote = withNote.replace("<!-- REVIEW: 数値は Q2 版に更新済みか？ -->\n", "");
    const a = parseMd(withNote).slides[0];
    const b = parseMd(withoutNote).slides[0];
    expect(a.layout).toBe(b.layout);
    expect(a.placeholders).toEqual(b.placeholders);
    expect(a.groupKind).toBe(b.groupKind);
  });

  it("drops a comment-only line inside a grouped column without disturbing the columns", () => {
    const md = `# 比較

<!-- col -->
<!-- note: 左は旧プラン -->
- 旧プラン

<!-- col -->
- 新プラン`;
    const s = parseMd(md).slides[0];
    expect(paraTexts(s, "1")).toEqual(["旧プラン"]);
    expect(paraTexts(s, "2")).toEqual(["新プラン"]);
  });

  it("keeps comment-looking strings inside a ``` fence verbatim (code block unbroken)", () => {
    const md = `# T

\`\`\`html
<!-- これはコードの一部 -->
<div>ok</div>
\`\`\``;
    const s = parseMd(md).slides[0];
    expect(s.code?.content).toBe("<!-- これはコードの一部 -->\n<div>ok</div>");
  });

  it("keeps a line with text OUTSIDE the comment markers (not comment-only → untouched)", () => {
    const md = `# T

<!-- a --> 本文の続き <!-- b -->`;
    expect(paraTexts(parseMd(md).slides[0], "1")).toEqual(["<!-- a --> 本文の続き <!-- b -->"]);
  });

  it("dropped comments do not round-trip (spec: serializer never sees them)", () => {
    const md = `# タイトル

<!-- REVIEW: 要確認 -->
- 論点A`;
    const round = serializeMd(parseMd(md));
    expect(round).not.toContain("REVIEW");
    expect(round).toContain("論点A");
  });

  it("keeps sourceLineStart/End spanning the ORIGINAL block (useDeckRevise slices raw md)", () => {
    const md = `# S1

<!-- note -->
- A

---

# S2

- B`;
    const [s1, s2] = parseMd(md).slides;
    // S1's block = lines 1..5 of the raw md (comment line included in the span).
    expect(s1.sourceLineStart).toBe(1);
    expect(s1.sourceLineEnd).toBe(5);
    expect(s2.sourceLineStart).toBe(7);
    expect(s2.sourceLineEnd).toBe(10);
  });

  it("a slide whose body was ONLY comments falls back like an empty body", () => {
    const md = `# タイトルだけ

<!-- TODO 本文を書く -->`;
    const s = parseMd(md).slides[0];
    expect(s.placeholders.find((p) => p.idx === "1")).toBeUndefined();
    expect(s.placeholders.some((p) => p.idx === "15" || p.idx === "0")).toBe(true); // title intact
  });

  it("drops a line that is NOTHING but multiple comments (zero visible text)", () => {
    const md = `# T

<!-- REVIEW --><!-- [S01] -->
<!-- a --> <!-- b -->
- 論点A`;
    expect(paraTexts(parseMd(md).slides[0], "1")).toEqual(["論点A"]);
  });

  it("drops the WHATWG abrupt-close degenerate comments <!--> and <!--->", () => {
    // Both are parse-error-but-comment-node forms that render as NOTHING in any HTML
    // view — exactly the stray-note artifact class #147 targets.
    const md = `# T

<!-->
<!--->
- 論点A`;
    expect(paraTexts(parseMd(md).slides[0], "1")).toEqual(["論点A"]);
  });

  it("drops comment-only lines under CRLF line endings (strip matches the trimmed line)", () => {
    const md = "# T\r\n\r\n<!-- REVIEW: note -->\r\n- 論点A\r\n\r\n<!-- TODO -->\r\n- 論点B";
    expect(paraTexts(parseMd(md).slides[0], "1")).toEqual(["論点A", "論点B"]);
  });
});
