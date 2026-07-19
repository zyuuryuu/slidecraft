/**
 * font-stack.test.ts — CJK-aware font-family fallback (#192 / #115-a).
 */
import { describe, it, expect } from "vitest";
import { classifyCjkFont, cjkFontFamily } from "../src/engine/font-stack";

describe("classifyCjkFont", () => {
  it("classifies Mincho names (ASCII and Japanese)", () => {
    expect(classifyCjkFont("Yu Mincho")).toBe("mincho");
    expect(classifyCjkFont("游明朝")).toBe("mincho");
    expect(classifyCjkFont("MS Pmincho")).toBe("mincho");
  });

  it("classifies Gothic names, and defaults to gothic for unknown/absent names", () => {
    expect(classifyCjkFont("Yu Gothic")).toBe("gothic");
    expect(classifyCjkFont("游ゴシック")).toBe("gothic");
    expect(classifyCjkFont("Calibri")).toBe("gothic");
    expect(classifyCjkFont(undefined)).toBe("gothic");
  });

  it("does not misclassify 'sans-serif' or other generic gothic-adjacent names as Mincho", () => {
    expect(classifyCjkFont("sans-serif")).toBe("gothic");
    expect(classifyCjkFont("Noto Sans CJK JP")).toBe("gothic");
  });
});

describe("cjkFontFamily", () => {
  it("puts the Latin font first, includes an ordered Gothic fallback chain, ends in the CSS generic", () => {
    const css = cjkFontFamily("Calibri");
    const names = css.split(", ");
    expect(names[0]).toBe("Calibri");
    expect(names).toContain('"Yu Gothic"');
    expect(names).toContain('"Hiragino Kaku Gothic ProN"');
    expect(names).toContain('"Noto Sans CJK JP"');
    expect(names).toContain("Meiryo");
    expect(names[names.length - 1]).toBe("sans-serif");
  });

  it("picks the Mincho fallback chain when the ea font is a Mincho design", () => {
    const css = cjkFontFamily("Georgia", "游明朝");
    const names = css.split(", ");
    expect(names).toContain('"Yu Mincho"');
    expect(names).toContain('"Noto Serif CJK JP"');
    expect(names[names.length - 1]).toBe("serif");
    expect(names).not.toContain('"Yu Gothic"');
  });

  it("includes the declared ea font name explicitly (not just its classification)", () => {
    const css = cjkFontFamily("Calibri", "游ゴシック");
    expect(css).toContain('"游ゴシック"');
  });

  it("quotes multi-word / non-ASCII font names but leaves CSS generics bare", () => {
    const css = cjkFontFamily("Yu Gothic");
    expect(css).toContain('"Yu Gothic"');
    expect(css.endsWith("sans-serif")).toBe(true);
    expect(css).not.toMatch(/"sans-serif"/);
  });

  it("dedupes case-insensitively when the ea font matches a fallback-chain entry", () => {
    const css = cjkFontFamily("Calibri", "Yu Gothic");
    const names = css.split(", ");
    expect(names.filter((n) => n === '"Yu Gothic"')).toHaveLength(1);
  });

  it("no eaFontName: still resolves a full ordered stack, not a bare 'fontName, sans-serif' pair", () => {
    const css = cjkFontFamily("Arial");
    expect(css.split(", ").length).toBeGreaterThan(2);
  });
});
