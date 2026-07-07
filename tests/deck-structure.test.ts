/**
 * deck-structure.test.ts — the pure slide-structure ops shared by MCP + GUI: survivors byte-identical
 * (refs preserved), duplicate deep-clones, last-slide delete rejected, moves permute.
 */
import { describe, it, expect } from "vitest";
import type { DeckIR, SlideIR } from "../src/engine/slide-schema";
import { insertSlideAt, deleteSlideAt, duplicateSlideAt, moveSlideTo, blankSlide, addBlankSlide } from "../src/engine/deck-structure";

const s = (title: string, extra: Partial<SlideIR> = {}): SlideIR => ({
  layout: "auto",
  placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: title }] }] }],
  ...extra,
});
const deck = (...titles: string[]): DeckIR => ({ slides: titles.map((t) => s(t)) });
const titles = (d: DeckIR) => d.slides.map((sl) => sl.placeholders[0]?.paragraphs[0]?.segments[0]?.text);

describe("insertSlideAt", () => {
  it("inserts after the index and returns the landing index; survivors keep their refs", () => {
    const d = deck("A", "B");
    const { deck: out, at } = insertSlideAt(d, 0, blankSlide(), "after");
    expect(at).toBe(1);
    expect(titles(out)).toEqual(["A", undefined, "B"]);
    expect(out.slides[0]).toBe(d.slides[0]); // survivor byte-identical (same ref)
    expect(out.slides[2]).toBe(d.slides[1]);
  });
  it("inserts before, and clamps an out-of-range index into the deck", () => {
    expect(insertSlideAt(deck("A", "B"), 0, s("X"), "before").at).toBe(0);
    expect(insertSlideAt(deck("A"), 9, s("X"), "after").at).toBe(1); // clamped to end
  });
});

describe("addBlankSlide (＋ works on an EMPTY app)", () => {
  it("mints a one-slide deck when the deck is null (blank start — no Markdown yet)", () => {
    const { deck: out, at } = addBlankSlide(null, 0);
    expect(at).toBe(0);
    expect(out.slides.length).toBe(1); // a real deck now exists → preview renders it, editor edits it
    expect(out.slides[0]).toEqual(blankSlide());
  });
  it("adds after the active slide on a non-empty deck (unchanged behavior)", () => {
    const d = deck("A", "B");
    const { deck: out, at } = addBlankSlide(d, 0);
    expect(at).toBe(1);
    expect(titles(out)).toEqual(["A", undefined, "B"]);
  });
});

describe("deleteSlideAt", () => {
  it("removes the slide, survivors keep refs", () => {
    const d = deck("A", "B", "C");
    const out = deleteSlideAt(d, 1)!;
    expect(titles(out)).toEqual(["A", "C"]);
    expect(out.slides[0]).toBe(d.slides[0]);
    expect(out.slides[1]).toBe(d.slides[2]);
  });
  it("rejects deleting the LAST remaining slide (null), and out-of-range", () => {
    expect(deleteSlideAt(deck("solo"), 0)).toBeNull();
    expect(deleteSlideAt(deck("A", "B"), 5)).toBeNull();
  });
});

describe("duplicateSlideAt", () => {
  it("deep-clones (figure copied byte-identical, NOT shared) and lands adjacent", () => {
    const d: DeckIR = { slides: [s("A", { diagram: { yaml: "type: flowchart\nnodes: []", placeholderIdx: "1" } })] };
    const { deck: out, newIndex } = duplicateSlideAt(d, 0, "after");
    expect(newIndex).toBe(1);
    expect(out.slides).toHaveLength(2);
    expect(out.slides[1].diagram).toEqual(out.slides[0].diagram);
    expect(out.slides[1].diagram).not.toBe(out.slides[0].diagram); // deep clone, not a shared ref
    expect(out.slides[0]).toBe(d.slides[0]); // the original survivor keeps its ref
  });
});

describe("moveSlideTo", () => {
  it("permutes; from===to and OOB are no-ops (same deck)", () => {
    expect(titles(moveSlideTo(deck("A", "B", "C"), 0, 2))).toEqual(["B", "C", "A"]);
    const d = deck("A", "B");
    expect(moveSlideTo(d, 1, 1)).toBe(d);
    expect(moveSlideTo(d, 5, 0)).toBe(d);
  });
});

describe("blankSlide", () => {
  it("is a fresh empty content slide (auto layout)", () => {
    expect(blankSlide()).toEqual({ layout: "auto", placeholders: [] });
  });
});
