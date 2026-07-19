/**
 * md-comment-escape.test.ts — #165: a GUI-authored comment-only PLAIN paragraph (segment text is,
 * trimmed, exactly one complete `<!-- … -->`) must survive the serialize→parse round-trip that
 * ai-apply/useDeckRevise run internally, instead of colliding with #147's comment-only-line drop.
 *
 * Fix (issue #165 confirmed comment, 案1): the serializer escapes such a paragraph's leading `<` to
 * `\<` so the emitted line no longer matches the #147 comment-only-line pattern; the parser strips
 * exactly that one leading backslash back off a plain line's `\<` lead. No general backslash-escape
 * mechanism — this is the ONLY case stripped (scope kept minimal per the confirmed comment).
 */

import { describe, it, expect } from "vitest";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { serializeParagraphs } from "../src/engine/md-serializer-shared";
import type { DeckIR, SlideIR, Paragraph } from "../src/engine/slide-schema";

/** Flatten a placeholder's paragraphs to plain-text lines (segments joined). */
function paraTexts(slide: SlideIR, idx: string): string[] {
  const ph = slide.placeholders.find((p) => p.idx === idx);
  return (ph?.paragraphs ?? []).map((p: Paragraph) => p.segments.map((s) => s.text).join(""));
}

describe("serializeParagraphs — comment-only plain paragraph escape (#165)", () => {
  it("escapes a comment-only PLAIN paragraph's leading `<` to `\\<`", () => {
    const out = serializeParagraphs([{ segments: [{ text: "<!-- メモ -->" }] }]);
    expect(out).toBe("\\<!-- メモ -->");
  });

  it("does NOT escape ordinary text (no interaction, byte-identical for the common case)", () => {
    const out = serializeParagraphs([{ segments: [{ text: "body line" }] }]);
    expect(out).toBe("body line");
  });

  it("does NOT escape a paragraph where the comment is only PART of the text (not comment-only)", () => {
    const out = serializeParagraphs([{ segments: [{ text: "<!-- a --> 本文の続き" }] }]);
    expect(out).toBe("<!-- a --> 本文の続き");
  });

  it("does NOT escape a paragraph with MORE than one comment (spec: exactly one complete comment)", () => {
    const out = serializeParagraphs([{ segments: [{ text: "<!-- a --><!-- b -->" }] }]);
    expect(out).toBe("<!-- a --><!-- b -->");
  });

  it("does NOT escape a heading paragraph even if its text is comment-only (only plain paragraphs)", () => {
    const out = serializeParagraphs([{ segments: [{ text: "<!-- メモ -->" }], heading: true }]);
    expect(out).toBe("### <!-- メモ -->");
  });
});

describe("#165 acceptance: GUI-origin comment-only paragraph round-trips serialize→parse", () => {
  it("① a GUI-authored comment-only plain paragraph is unchanged after serializeMd→parseMd (ai-apply loop)", () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
            {
              idx: "1",
              paragraphs: [
                { segments: [{ text: "<!-- メモ -->" }] },
                { segments: [{ text: "body line" }] },
              ],
            },
          ],
        },
      ],
    };
    const md = serializeMd(deck);
    // The escaped line must be present in the emitted Markdown (else it would collide with #147's drop).
    expect(md).toContain("\\<!-- メモ -->");
    const roundTripped = parseMd(md).slides[0];
    expect(paraTexts(roundTripped, "1")).toEqual(["<!-- メモ -->", "body line"]);
  });

  it("② a RAW (md-origin, unescaped) comment-only line still drops — #163/#147 behavior is unchanged", () => {
    const md = `# タイトル

<!-- REVIEW: 要確認 -->
- 論点A`;
    const s = parseMd(md).slides[0];
    expect(paraTexts(s, "1")).toEqual(["論点A"]);
    const round = serializeMd(parseMd(md));
    expect(round).not.toContain("REVIEW");
  });

  it("③ a bullet paragraph's comment-only text round-trips as before (`- ` prefix, no escape needed)", () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "1", paragraphs: [{ segments: [{ text: "<!-- メモ -->" }], bullet: true }] },
          ],
        },
      ],
    };
    const md = serializeMd(deck);
    expect(md).toContain("- <!-- メモ -->");
    expect(md).not.toContain("\\<!-- メモ -->");
    const roundTripped = parseMd(md).slides[0];
    const ph = roundTripped.placeholders.find((p) => p.idx === "1");
    expect(ph?.paragraphs[0]).toMatchObject({ bullet: true });
    expect(paraTexts(roundTripped, "1")).toEqual(["<!-- メモ -->"]);
  });

  it("④ an existing deck with no comment-only plain paragraphs serializes byte-identically", () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          placeholders: [
            { idx: "15", paragraphs: [{ segments: [{ text: "見出し" }] }] },
            {
              idx: "1",
              paragraphs: [
                { segments: [{ text: "本文1行目" }] },
                { segments: [{ text: "本文2行目 <!-- inline note --> 続き" }] },
                { segments: [{ text: "箇条書き" }], bullet: true },
                { segments: [{ text: "グループ見出し" }], heading: true },
              ],
            },
          ],
        },
      ],
    };
    const expected =
      "<!-- slide: Content.1Body.Single -->\n# 見出し\n\n本文1行目\n本文2行目 <!-- inline note --> 続き\n- 箇条書き\n### グループ見出し\n";
    expect(serializeMd(deck)).toBe(expected);
  });
});
