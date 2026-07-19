/**
 * font-stack-embed-family.test.ts — embedFallbackFamily (#194) must name a family that's ALREADY
 * present in cjkFontFamily's fallback chain, so a runtime @font-face embed under that name is picked
 * up with zero per-element CSS changes. An agreement test (R8) pins the two together so they can't
 * silently drift apart.
 */
import { describe, it, expect } from "vitest";
import { cjkFontFamily, embedFallbackFamily } from "../src/engine/font-stack";

describe("embedFallbackFamily", () => {
  it("gothic maps to a real fallback family name", () => {
    expect(embedFallbackFamily("gothic")).toBe("Noto Sans CJK JP");
  });

  it("mincho maps to a real fallback family name", () => {
    expect(embedFallbackFamily("mincho")).toBe("Noto Serif CJK JP");
  });

  it("agreement: the gothic embed family literally appears in cjkFontFamily's gothic chain", () => {
    const chain = cjkFontFamily("SomeLatinFont");
    expect(chain).toContain(embedFallbackFamily("gothic"));
  });

  it("agreement: the mincho embed family literally appears in cjkFontFamily's mincho chain", () => {
    const chain = cjkFontFamily("SomeMincho明朝Font");
    expect(chain).toContain(embedFallbackFamily("mincho"));
  });
});
