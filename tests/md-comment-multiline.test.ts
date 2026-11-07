/**
 * md-comment-multiline.test.ts — #588: an HTML comment whose `<!--` and `-->` sit on DIFFERENT lines
 * renders as nothing in any HTML view, so (like #147's one-line case) it must not reach a slide.
 * Scope (統括裁定): only a unit that is WHOLLY comment — the opener line has nothing visible before the
 * comment, the closer line nothing visible after `-->`. A closer with trailing visible text (inline
 * comment = #147 第2弾) and an UNCLOSED comment keep their lines as text, exactly as before (never-silent).
 * Fence interiors stay verbatim; directive comments (slide/col/note/…) are untouched.
 */

import { describe, it, expect } from "vitest";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { serializeParagraphs } from "../src/engine/md-serializer-shared";
import type { DeckIR, SlideIR, Paragraph } from "../src/engine/slide-schema";

function paraTexts(slide: SlideIR, idx: string): string[] {
  const ph = slide.placeholders.find((p) => p.idx === idx);
  return (ph?.paragraphs ?? []).map((p: Paragraph) => p.segments.map((s) => s.text).join(""));
}
function allTexts(slide: SlideIR): string[] {
  return slide.placeholders.flatMap((p) => p.paragraphs.map((q) => q.segments.map((s) => s.text).join("")));
}
/** SlideIR minus the source-line span (which legitimately differs when lines are removed). */
function shape(slide: SlideIR): Omit<SlideIR, "sourceLineStart" | "sourceLineEnd"> {
  const rest: Partial<SlideIR> = { ...slide };
  delete rest.sourceLineStart;
  delete rest.sourceLineEnd;
  return rest as Omit<SlideIR, "sourceLineStart" | "sourceLineEnd">;
}

describe("parseMd — multi-line comment drop (#588)", () => {
  it("issue repro: a multi-line comment above the cover title never reaches the slide (acceptance)", () => {
    const md = `<!--
目標デッキ A: 営業（提案・ピッチ）14 枚。
素材 = samples/manuscript-01-business-proposal.md
-->
# 社内ナレッジ検索「Hubble」導入のご提案`;
    const s = parseMd(md).slides[0];
    const texts = allTexts(s).join("\n");
    expect(texts).not.toContain("目標デッキ");
    expect(texts).not.toContain("素材 =");
    // `# 見出し` stays the cover title exactly as if the comment were absent.
    expect(shape(s)).toEqual(shape(parseMd("# 社内ナレッジ検索「Hubble」導入のご提案").slides[0]));
  });

  it("drops a multi-line comment between body lines, swallowing its leading blanks like #147", () => {
    const md = `# T

論点A

<!-- REVIEW:
  この数字は要確認
-->
論点B`;
    expect(paraTexts(parseMd(md).slides[0], "1")).toEqual(["論点A", "論点B"]);
  });

  it("the unit ends at the FIRST `-->` (HTML semantics); lines after it are content", () => {
    const md = `# T

<!--
memo -->
- 論点A`;
    expect(paraTexts(parseMd(md).slides[0], "1")).toEqual(["論点A"]);
  });

  it("an opener line made of complete comments followed by an opener is still wholly comment", () => {
    const md = `# T

<!-- a --> <!-- b
c -->
- 論点A`;
    expect(paraTexts(parseMd(md).slides[0], "1")).toEqual(["論点A"]);
  });

  it("``` inside a multi-line comment is comment content, not a fence", () => {
    const md = "# T\n\n<!--\n```yaml\nx: 1\n```\n-->\n- 論点A";
    const s = parseMd(md).slides[0];
    expect(s.code).toBeUndefined();
    expect(paraTexts(s, "1")).toEqual(["論点A"]);
  });

  it("keeps sourceLineStart/End spanning the ORIGINAL block (comment lines included)", () => {
    const md = `# S1

<!--
memo
-->
- A

---

# S2`;
    const [s1, s2] = parseMd(md).slides;
    expect(s1.sourceLineStart).toBe(1);
    expect(s1.sourceLineEnd).toBe(7);
    expect(s2.sourceLineStart).toBe(9);
  });
});

describe("parseMd — multi-line comment: kept as text (never-silent / out of scope)", () => {
  it("an UNCLOSED comment keeps every line as text (not silently dropped)", () => {
    const md = `# T

<!-- 閉じ忘れ
本文が続く`;
    expect(paraTexts(parseMd(md).slides[0], "1")).toEqual(["<!-- 閉じ忘れ", "本文が続く"]);
  });

  it("a closer with visible text AFTER `-->` keeps the whole unit as text (inline comment = #147 第2弾)", () => {
    const md = `# T

<!--
memo
--> 見える本文`;
    expect(paraTexts(parseMd(md).slides[0], "1")).toEqual(["<!--", "memo", "--> 見える本文"]);
  });

  it("an opener with visible text BEFORE `<!--` is not a comment-only unit (kept as text)", () => {
    const md = `# T

本文 <!-- memo
-->`;
    expect(paraTexts(parseMd(md).slides[0], "1")).toEqual(["本文 <!-- memo", "-->"]);
  });

  it("a multi-line `<!-- slide:` is NOT silently dropped (a broken layout pin stays visible)", () => {
    const md = `# T

<!-- slide:
Content.1Body.Single -->
本文`;
    const s = parseMd(md).slides[0];
    expect(s.layout).toBe("auto");
    expect(paraTexts(s, "1")).toEqual(["<!-- slide:", "Content.1Body.Single -->", "本文"]);
  });

  it("`<!--` / `-->` inside a ``` fence stay code verbatim (fence wins)", () => {
    const md = "# T\n\n```html\n<!--\nkeep\n-->\n```";
    expect(parseMd(md).slides[0].code?.content).toBe("<!--\nkeep\n-->");
  });
});

describe("parseMd — directives / #147 behavior unchanged around multi-line comments", () => {
  it("one-line comments (#147) and directives still behave as before", () => {
    const md = `<!-- slide: Content.2Body.Compare -->
# T

<!-- col -->
<!-- REVIEW -->
- 左

<!-- col -->
- 右`;
    const s = parseMd(md).slides[0];
    expect(s.layout).toBe("Content.2Body.Compare");
    expect(paraTexts(s, "1")).toEqual(["左"]);
    expect(paraTexts(s, "2")).toEqual(["右"]);
  });

  it("a multi-line comment inside a grouped column drops without disturbing the columns", () => {
    const withComment = `<!-- slide: KPI.3Value.Equal -->
# Metrics

<!--
REVIEW: 数値は Q2 版に更新済みか？
-->
<!-- kpi -->
98.5%
Uptime

<!-- kpi -->
<!--
memo
-->
$2.4M
Revenue`;
    const without = `<!-- slide: KPI.3Value.Equal -->
# Metrics

<!-- kpi -->
98.5%
Uptime

<!-- kpi -->
$2.4M
Revenue`;
    const a = parseMd(withComment).slides[0];
    const b = parseMd(without).slides[0];
    expect(a.layout).toBe(b.layout);
    expect(a.placeholders).toEqual(b.placeholders);
    expect(a.groupKind).toBe(b.groupKind);
    expect(paraTexts(a, "2")).toEqual(["$2.4M", "Revenue"]);
  });

  it("`<!-- note -->` still splits notes; a multi-line comment in the notes area is dropped too", () => {
    const md = `# T

本文

<!-- note -->
話すこと
<!--
内部メモ
-->`;
    const s = parseMd(md).slides[0];
    expect(paraTexts(s, "1")).toEqual(["本文"]);
    expect((s.notes ?? []).map((p) => p.segments.map((x) => x.text).join(""))).toEqual(["話すこと"]);
  });
});

describe("round-trip: a GUI paragraph that opens a comment survives serialize→parse (#588 × #165)", () => {
  it("escapes a plain paragraph that opens an unclosed comment", () => {
    expect(serializeParagraphs([{ segments: [{ text: "<!-- start" }] }])).toBe("\\<!-- start");
    expect(serializeParagraphs([{ segments: [{ text: "body line" }] }])).toBe("body line");
  });

  it("paragraphs `<!--` / `x` / `-->` round-trip unchanged (no silent drop on re-parse)", () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
            {
              idx: "1",
              paragraphs: [
                { segments: [{ text: "<!--" }] },
                { segments: [{ text: "x" }] },
                { segments: [{ text: "-->" }] },
              ],
            },
          ],
        },
      ],
    };
    const md = serializeMd(deck);
    expect(paraTexts(parseMd(md).slides[0], "1")).toEqual(["<!--", "x", "-->"]);
    // and the re-serialized Markdown is stable (fixed point)
    expect(serializeMd(parseMd(md))).toBe(md);
  });

  it("an unclosed-comment text kept by the parser is a serialize→parse fixed point", () => {
    const md = `# T

<!-- 閉じ忘れ
本文が続く`;
    const once = parseMd(md);
    const md2 = serializeMd(once);
    expect(paraTexts(parseMd(md2).slides[0], "1")).toEqual(["<!-- 閉じ忘れ", "本文が続く"]);
    expect(serializeMd(parseMd(md2))).toBe(md2);
  });
});
