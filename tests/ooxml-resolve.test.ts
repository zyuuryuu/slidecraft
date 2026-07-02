/**
 * ooxml-resolve.test.ts — the pure resolution primitives the template loader is built on.
 */
import { describe, it, expect } from "vitest";
import { resolve, parseColorRef, resolveColor, luminance, isDark, emuToInch } from "../src/engine/ooxml-resolve";

describe("resolve (inheritance fold)", () => {
  it("takes the first defined candidate", () => {
    expect(resolve(undefined, undefined, "x")).toBe("x");
    expect(resolve("own", "inherited", "default")).toBe("own");
    expect(resolve(undefined, 5, 0)).toBe(5);
    expect(resolve<number>()).toBeUndefined();
  });
  it("treats 0 / '' / false as DEFINED (only undefined is skipped)", () => {
    expect(resolve(0, 99)).toBe(0);
    expect(resolve("", "fallback")).toBe("");
    expect(resolve(false, true)).toBe(false);
  });
});

describe("parseColorRef + resolveColor", () => {
  const ctx = { theme: { tx1: "111111", bg1: "FFFFFF", accent1: "0A5A87" } };
  it("parses srgb and resolves it to itself (upper-cased)", () => {
    expect(parseColorRef('<a:solidFill><a:srgbClr val="0a5a87"/></a:solidFill>')).toEqual({ srgb: "0A5A87" });
    expect(resolveColor({ srgb: "0A5A87" }, ctx)).toBe("0A5A87");
  });
  it("parses a scheme token and resolves it through the theme (clrMap aliases folded in)", () => {
    expect(parseColorRef('<a:schemeClr val="accent1"/>')).toEqual({ scheme: "accent1" });
    expect(resolveColor({ scheme: "accent1" }, ctx)).toBe("0A5A87");
    expect(resolveColor({ scheme: "tx1" }, ctx)).toBe("111111");
  });
  it("takes only the FIRST color in the scoped fragment (caller scopes the region)", () => {
    expect(parseColorRef('<a:srgbClr val="AABBCC"/><a:srgbClr val="112233"/>')).toEqual({ srgb: "AABBCC" });
  });
  it("returns undefined for no color / an unknown scheme token", () => {
    expect(parseColorRef("<a:noFill/>")).toBeUndefined();
    expect(resolveColor({ scheme: "phClr" }, ctx)).toBeUndefined();
  });
});

describe("luminance / isDark", () => {
  it("classifies dark vs light backgrounds", () => {
    expect(isDark("0A5A87")).toBe(true); // the report cover's dark blue
    expect(isDark("FFFFFF")).toBe(false);
    expect(isDark("000000")).toBe(true);
    expect(luminance("FFFFFF")).toBeCloseTo(1, 2);
  });
});

describe("emuToInch", () => {
  it("converts EMU to inches, 0 for absent", () => {
    expect(emuToInch(914400)).toBe(1);
    expect(emuToInch("548640")).toBeCloseTo(0.6, 5);
    expect(emuToInch(undefined)).toBe(0);
  });
});
