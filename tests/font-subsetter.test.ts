/**
 * font-subsetter.test.ts — runtime WASM CJK font subsetting (#193 / #115-b).
 *
 * Acceptance criteria (issue #193):
 *  1. Subsetting a font down to a deck's actual used characters yields a non-empty WOFF2 buffer
 *     substantially smaller than the original font.
 *  2. A character absent from the source font (e.g. an emoji) never crashes the subsetter — it's
 *     silently dropped from the subset, leaving the rest of the fallback stack (#192) to render it.
 */
import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { subsetFontToWoff2 } from "../src/components/font-subsetter";
import { collectDeckText } from "../src/engine/deck-text-collect";
import type { DeckIR } from "../src/engine/slide-schema";

// A synthetic TTF authored for this test only (fontTools, ~400 dummy square glyphs covering
// ASCII + the JP test text below + 300 unused CJK-range padding codepoints so subsetting has
// something real to discard) — no third-party font content, so it carries no license obligations.
// The real Noto Sans/Serif JP source fonts land in a later #193 PR (the asset-bundling half).
const FIXTURE_PATH = resolve(__dirname, "fixtures/font-subset-test.ttf");

async function loadFixtureFont(): Promise<Uint8Array> {
  const buf = await readFile(FIXTURE_PATH);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const JP_DECK: DeckIR = {
  slides: [
    {
      layout: "auto",
      placeholders: [{ idx: "0", paragraphs: [{ segments: [{ text: "日本語こんにちは" }] }] }],
    },
  ],
};

describe("subsetFontToWoff2", () => {
  it("produces a non-empty WOFF2 buffer substantially smaller than the source font", async () => {
    const original = await loadFixtureFont();
    const text = collectDeckText(JP_DECK);
    const subset = await subsetFontToWoff2(original, text);

    expect(subset.byteLength).toBeGreaterThan(0);
    expect(subset.byteLength).toBeLessThan(original.byteLength / 2);
  });

  it("does not crash when the deck contains a character absent from the source font", async () => {
    const original = await loadFixtureFont();
    const deckWithEmoji: DeckIR = {
      slides: [
        {
          layout: "auto",
          placeholders: [{ idx: "0", paragraphs: [{ segments: [{ text: "日本語こんにちは😀" }] }] }],
        },
      ],
    };
    const text = collectDeckText(deckWithEmoji);

    await expect(subsetFontToWoff2(original, text)).resolves.toBeInstanceOf(Uint8Array);
    const subset = await subsetFontToWoff2(original, text);
    expect(subset.byteLength).toBeGreaterThan(0);
  });

  it("rejects (does not throw synchronously) on a corrupt/non-font buffer, for callers to fall back", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(subsetFontToWoff2(garbage, "abc")).rejects.toThrow();
  });
});
