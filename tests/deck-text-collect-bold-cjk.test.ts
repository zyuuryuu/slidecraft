/**
 * deck-text-collect-bold-cjk.test.ts — the two small predicates #194 adds to deck-text-collect.ts to
 * drive the HTML-export font-embedding pipeline: which weights to subset (deckUsesBold) and whether
 * embedding is worth attempting at all (deckHasCjkText).
 */
import { describe, it, expect } from "vitest";
import { deckUsesBold, deckHasCjkText } from "../src/engine/deck-text-collect";
import type { DeckIR } from "../src/engine/slide-schema";

function deckWith(placeholders: DeckIR["slides"][number]["placeholders"], extra: Partial<DeckIR["slides"][number]> = {}): DeckIR {
  return { slides: [{ layout: "auto", placeholders, ...extra }] };
}

describe("deckUsesBold", () => {
  it("false for a deck with no bold segments, no headings, no table", () => {
    const deck = deckWith([{ idx: "0", paragraphs: [{ segments: [{ text: "plain text" }] }] }]);
    expect(deckUsesBold(deck)).toBe(false);
  });

  it("true when any inline segment is bold", () => {
    const deck = deckWith([{ idx: "0", paragraphs: [{ segments: [{ text: "a" }, { text: "b", bold: true }] }] }]);
    expect(deckUsesBold(deck)).toBe(true);
  });

  it("true when a paragraph is a group heading", () => {
    const deck = deckWith([{ idx: "0", paragraphs: [{ segments: [{ text: "見出し" }], heading: true }] }]);
    expect(deckUsesBold(deck)).toBe(true);
  });

  it("true when a slide has a table with header row", () => {
    const deck = deckWith([{ idx: "0", paragraphs: [{ segments: [{ text: "x" }] }] }], {
      table: { rows: [["h1", "h2"], ["a", "b"]], header: true, placeholderIdx: "1" },
    });
    expect(deckUsesBold(deck)).toBe(true);
  });

  it("false when the table has no header row (header: false)", () => {
    const deck = deckWith([{ idx: "0", paragraphs: [{ segments: [{ text: "x" }] }] }], {
      table: { rows: [["a", "b"]], header: false, placeholderIdx: "1" },
    });
    expect(deckUsesBold(deck)).toBe(false);
  });

  it("true when a speaker note has a bold segment", () => {
    const deck = deckWith([{ idx: "0", paragraphs: [{ segments: [{ text: "x" }] }] }], {
      notes: [{ segments: [{ text: "note", bold: true }] }],
    });
    expect(deckUsesBold(deck)).toBe(true);
  });
});

describe("deckHasCjkText", () => {
  it("false for pure ASCII text", () => {
    expect(deckHasCjkText("Quarterly Review 2026 — revenue up 12%")).toBe(false);
  });

  it("true for text containing hiragana/kanji", () => {
    expect(deckHasCjkText("四半期レビュー")).toBe(true);
  });

  it("true for text containing only katakana", () => {
    expect(deckHasCjkText("カタカナ")).toBe(true);
  });

  it("false for an empty string", () => {
    expect(deckHasCjkText("")).toBe(false);
  });
});
