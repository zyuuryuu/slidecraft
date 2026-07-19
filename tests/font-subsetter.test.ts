/**
 * font-subsetter.test.ts — runtime WASM CJK font subsetting (#193 / #115-b / #194).
 *
 * Acceptance criteria (issue #193):
 *  1. Subsetting a font down to a deck's actual used characters yields a non-empty sfnt (TTF)
 *     buffer substantially smaller than the original font.
 *  2. A character absent from the source font (e.g. an emoji) never crashes the subsetter — it's
 *     silently dropped from the subset, leaving the rest of the fallback stack (#192) to render it.
 *
 * No WOFF2 compression (#194): an earlier version piped the subset through `wawoff2`, but that
 * package hangs forever when loaded through Vite's browser dep-optimizer (confirmed in a real
 * Chromium session and in CI's e2e job) — unmaintained since 2022, no fix available. The raw sfnt
 * harfbuzz produces is embedded directly instead (`format("truetype")`), sidestepping the broken
 * dependency; see font-subsetter.ts's file header for the full account.
 */
import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { subsetFontToTtf } from "../src/components/font-subsetter";
import { collectDeckText } from "../src/engine/deck-text-collect";
import type { DeckIR } from "../src/engine/slide-schema";

// A synthetic TTF authored for this test only (fontTools, ~400 dummy square glyphs covering
// ASCII + the JP test text below + 300 unused CJK-range padding codepoints so subsetting has
// something real to discard) — no third-party font content, so it carries no license obligations.
const FIXTURE_PATH = resolve(__dirname, "fixtures/font-subset-test.ttf");

// The real bundled source font (#193 asset half) — Noto Sans JP, a variable font (wght 100-900).
// Used below to test the variationAxes weight-pinning path against production-shaped input.
const NOTO_SANS_JP_PATH = resolve(__dirname, "../public/fonts/NotoSansJP-Variable.ttf");

async function loadFont(path: string): Promise<Uint8Array> {
  const buf = await readFile(path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function loadFixtureFont(): Promise<Uint8Array> {
  return loadFont(FIXTURE_PATH);
}

const JP_DECK: DeckIR = {
  slides: [
    {
      layout: "auto",
      placeholders: [{ idx: "0", paragraphs: [{ segments: [{ text: "日本語こんにちは" }] }] }],
    },
  ],
};

describe("subsetFontToTtf", () => {
  it("produces a non-empty sfnt buffer substantially smaller than the source font", async () => {
    const original = await loadFixtureFont();
    const text = collectDeckText(JP_DECK);
    const subset = await subsetFontToTtf(original, text);

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

    await expect(subsetFontToTtf(original, text)).resolves.toBeInstanceOf(Uint8Array);
    const subset = await subsetFontToTtf(original, text);
    expect(subset.byteLength).toBeGreaterThan(0);
  });

  it("rejects (does not throw synchronously) on a corrupt/non-font buffer, for callers to fall back", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(subsetFontToTtf(garbage, "abc")).rejects.toThrow();
  });
});

describe("subsetFontToTtf — variable-font weight pinning (#193 asset half)", () => {
  const text = "日本語のスライド資料を作成します。こんにちは、世界！";

  it("pins the wght axis so Regular (400) and Bold (700) subsets differ", async () => {
    const original = await loadFont(NOTO_SANS_JP_PATH);
    const regular = await subsetFontToTtf(original, text, { wght: 400 });
    const bold = await subsetFontToTtf(original, text, { wght: 700 });

    expect(regular.byteLength).toBeGreaterThan(0);
    expect(bold.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(regular).equals(Buffer.from(bold))).toBe(false);
  });

  it("produces a sfnt buffer many orders of magnitude smaller than the ~9.6 MB source", async () => {
    const original = await loadFont(NOTO_SANS_JP_PATH);
    const subset = await subsetFontToTtf(original, text, { wght: 400 });

    expect(subset.byteLength).toBeGreaterThan(0);
    expect(subset.byteLength).toBeLessThan(original.byteLength / 100);
  });
});
