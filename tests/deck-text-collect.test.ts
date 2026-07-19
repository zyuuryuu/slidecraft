/**
 * deck-text-collect.test.ts — pure text collection for runtime font subsetting (#193).
 */
import { describe, it, expect } from "vitest";
import { collectDeckText } from "../src/engine/deck-text-collect";
import type { DeckIR } from "../src/engine/slide-schema";

function deck(slides: DeckIR["slides"]): DeckIR {
  return { slides };
}

describe("collectDeckText", () => {
  it("collects placeholder paragraph text across all slides", () => {
    const d = deck([
      { layout: "auto", placeholders: [{ idx: "0", paragraphs: [{ segments: [{ text: "日本語のタイトル" }] }] }] },
      { layout: "auto", placeholders: [{ idx: "1", paragraphs: [{ segments: [{ text: "本文です" }, { text: "、続き" }] }] }] },
    ]);
    const text = collectDeckText(d);
    expect(text).toContain("日本語のタイトル");
    expect(text).toContain("本文です");
    expect(text).toContain("続き");
  });

  it("collects table cells, code content, image alt text, and speaker notes", () => {
    const d = deck([
      {
        layout: "auto",
        placeholders: [],
        table: { rows: [["列A", "列B"], ["値1", "値2"]], header: true, placeholderIdx: "1" },
        code: { content: "console.log('コード')", placeholderIdx: "1" },
        image: { src: "data:image/png;base64,AA==", alt: "画像の説明", placeholderIdx: "1" },
        notes: [{ segments: [{ text: "スピーカーノート" }] }],
      },
    ]);
    const text = collectDeckText(d);
    expect(text).toContain("列A");
    expect(text).toContain("値2");
    expect(text).toContain("コード");
    expect(text).toContain("画像の説明");
    expect(text).toContain("スピーカーノート");
  });

  it("returns an empty string for a deck with no text anywhere", () => {
    const d = deck([{ layout: "auto", placeholders: [{ idx: "0", paragraphs: [] }] }]);
    expect(collectDeckText(d)).toBe("");
  });

  it("does not crash on a deck with only optional blocks absent", () => {
    const d = deck([{ layout: "auto", placeholders: [{ idx: "0", paragraphs: [{ segments: [{ text: "OK" }] }] }] }]);
    expect(() => collectDeckText(d)).not.toThrow();
  });
});
