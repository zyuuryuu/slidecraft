/**
 * apply-field-edit.test.ts
 *
 * The editor's field-edit primitive (SlideEditor.updatePlaceholder delegates to applyFieldEdit).
 * Clearing a field must DROP its placeholder — not leave `{ idx, paragraphs: [{ segments: [{ text: "" }] }] }`
 * behind — so the model stays clean and a cleared field round-trips as absent (no empty <a:p> on export).
 * This mirrors the bijection model `editByPh` in field-map-bijection.test.ts (clear removes, type upserts).
 */
import { describe, it, expect } from "vitest";
import type { Paragraph } from "../src/engine/slide-schema";
import { applyFieldEdit, isBlankParagraphs } from "../src/engine/placeholder-binding";

// What SlideEditor.textToParagraphs("") produces: a single empty-segment paragraph (NOT []).
const cleared: Paragraph[] = [{ segments: [{ text: "" }] }];
const para = (text: string): Paragraph[] => [{ segments: [{ text }] }];

describe("isBlankParagraphs", () => {
  it("is true for a cleared field, whitespace-only, and multi-blank paragraphs", () => {
    expect(isBlankParagraphs(cleared)).toBe(true);
    expect(isBlankParagraphs(para("   "))).toBe(true);
    expect(isBlankParagraphs([{ segments: [{ text: "" }] }, { segments: [{ text: "  " }] }])).toBe(true);
  });
  it("is false when any segment carries visible text", () => {
    expect(isBlankParagraphs(para("hi"))).toBe(false);
    expect(isBlankParagraphs([{ segments: [{ text: "" }] }, { segments: [{ text: "b" }] }])).toBe(false);
  });
});

describe("applyFieldEdit", () => {
  const base = [
    { idx: "0", paragraphs: para("Title") },
    { idx: "1", paragraphs: para("Body") },
  ];

  it("clearing a field removes its placeholder and leaves the others untouched", () => {
    const out = applyFieldEdit(base, "1", cleared);
    expect(out.some((p) => p.idx === "1")).toBe(false);
    expect(out).toEqual([{ idx: "0", paragraphs: para("Title") }]);
  });

  it("clearing an absent field is a no-op (no empty placeholder created)", () => {
    const out = applyFieldEdit(base, "16", cleared);
    expect(out).toEqual(base);
  });

  it("editing an existing field updates only its paragraphs", () => {
    const out = applyFieldEdit(base, "1", para("New Body"));
    expect(out.find((p) => p.idx === "1")?.paragraphs).toEqual(para("New Body"));
    expect(out.find((p) => p.idx === "0")?.paragraphs).toEqual(para("Title"));
  });

  it("editing a new field appends it", () => {
    const out = applyFieldEdit(base, "16", para("Subtitle"));
    expect(out.find((p) => p.idx === "16")?.paragraphs).toEqual(para("Subtitle"));
    expect(out).toHaveLength(3);
  });

  it("does not mutate the input array", () => {
    const input = [...base];
    applyFieldEdit(input, "1", cleared);
    expect(input).toHaveLength(2);
  });
});
