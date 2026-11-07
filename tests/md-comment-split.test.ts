/**
 * md-comment-split.test.ts — #591: a `---` INSIDE a multi-line HTML comment must not split the slide.
 * The slide-split loop shares #588's "wholly-comment unit" judgment (md-comments.ts, R8): only a comment
 * CONFIRMED to close (closer line with nothing visible after `-->`) shields its `---`. After an UNCLOSED
 * `<!--` the `---` still splits as before (one forgotten closer must not swallow the rest of the deck).
 * Fence `---` stays unsplit; decks without such comments split byte-identically.
 */

import { describe, it, expect } from "vitest";
import { parseMd } from "../src/engine/md-parser";
import type { SlideIR, Paragraph } from "../src/engine/slide-schema";

function paraTexts(slide: SlideIR, idx: string): string[] {
  const ph = slide.placeholders.find((p) => p.idx === idx);
  return (ph?.paragraphs ?? []).map((p: Paragraph) => p.segments.map((s) => s.text).join(""));
}
function allTexts(slide: SlideIR): string[] {
  return slide.placeholders.flatMap((p) => p.paragraphs.map((q) => q.segments.map((s) => s.text).join("")));
}

describe("parseMd — `---` inside a multi-line comment (#591)", () => {
  it("issue repro: one slide, body is only 本文 (acceptance)", () => {
    const md = "# A\n\n<!--\nmemo\n---\nmore\n-->\n本文";
    const deck = parseMd(md);
    expect(deck.slides).toHaveLength(1);
    expect(paraTexts(deck.slides[0], "1")).toEqual(["本文"]);
    expect(allTexts(deck.slides[0]).join("\n")).not.toMatch(/memo|more|<!--|-->/);
  });

  it("sourceLineStart/End span the comment and the next slide starts after the real separator", () => {
    const md = "# A\n\n<!--\nmemo\n---\nmore\n-->\n本文\n---\n# B\nx";
    const deck = parseMd(md);
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0].sourceLineStart).toBe(1);
    expect(deck.slides[0].sourceLineEnd).toBe(8);
    expect(deck.slides[1].sourceLineStart).toBe(10);
    expect(deck.slides[1].sourceLineEnd).toBe(11);
  });

  it("sourceLines account for YAML front matter", () => {
    const md = "---\ntemplate: t\n---\n# A\n<!--\n---\n-->\nx\n---\n# B";
    const deck = parseMd(md);
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0].sourceLineStart).toBe(4);
    expect(deck.slides[0].sourceLineEnd).toBe(8);
    expect(deck.slides[1].sourceLineStart).toBe(10);
  });

  it("an UNCLOSED `<!--` does not shield `---`: splitting is unchanged (never-silent)", () => {
    const md = "# A\n<!--\nmemo\n---\n# B\nx\n---\n# C";
    const deck = parseMd(md);
    expect(deck.slides).toHaveLength(3);
    expect(allTexts(deck.slides[0])).toEqual(["A", "<!--", "memo"]);
  });

  it("a closer with trailing visible text (inline comment) does not shield `---` (same scope as #588)", () => {
    const md = "# A\n<!--\n---\n--> tail\n";
    expect(parseMd(md).slides).toHaveLength(2);
  });

  it("a ``` inside a closed comment is comment content and does not open a fence", () => {
    const md = "# A\n<!--\n```\n-->\nx\n---\n# B";
    const deck = parseMd(md);
    expect(deck.slides).toHaveLength(2);
    expect(paraTexts(deck.slides[0], "1")).toEqual(["x"]);
  });

  it("`<!--` inside a fence does not open a comment: the fence rule alone decides", () => {
    const md = "# A\n```\n<!--\n```\n---\n# B\n-->";
    expect(parseMd(md).slides).toHaveLength(2);
  });

  it("decks without comments, and comments without `---`, split identically to before", () => {
    const plain = "# A\nx\n---\n# B\n```\n---\n```\n---\n# C";
    const d = parseMd(plain);
    expect(d.slides.map((s) => [s.sourceLineStart, s.sourceLineEnd])).toEqual([[1, 2], [4, 7], [9, 9]]);
    const commented = "# A\n<!--\nmemo\n-->\nx\n---\n# B";
    const c = parseMd(commented);
    expect(c.slides.map((s) => [s.sourceLineStart, s.sourceLineEnd])).toEqual([[1, 5], [7, 7]]);
  });
});
