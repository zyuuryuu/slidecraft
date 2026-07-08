/**
 * placeholder-role-precedence.test.ts — an explicit placeholder TYPE must win over the idx convention.
 * Regression: a template whose footer is type="ftr" at idx 11 was misclassified "date" by the idx-11
 * rule, so footer CONTENT had no role-matched placeholder and silently dropped in preview + export.
 * The canonical convention (typeless "body" meta at idx 10/11/12 → category/date/footer) must survive.
 */
import { describe, it, expect } from "vitest";
import { placeholderRole } from "../src/engine/template-catalog";
import type { PlaceholderInfo } from "../src/engine/template-loader";

const ph = (type: string, idx: string): PlaceholderInfo => ({
  idx, type, name: "", shapeXml: "",
  style: { x: 1, y: 6, w: 2, h: 0.4, fontSize: 12, fontColor: "000000", fontName: "Calibri", bold: false, align: "l", bulletChar: "" },
});

describe("placeholderRole: explicit type wins over idx convention", () => {
  it("a type='ftr' at idx 11 is FOOTER (not date from the idx-11 rule)", () => {
    expect(placeholderRole(ph("ftr", "11"))).toBe("footer");
    expect(placeholderRole(ph("dt", "10"))).toBe("date");
    expect(placeholderRole(ph("sldNum", "12"))).toBe("slideNumber");
  });

  it("keeps the canonical convention: typeless BODY meta at idx 10/11/12 → category/date/footer", () => {
    expect(placeholderRole(ph("body", "10"))).toBe("category");
    expect(placeholderRole(ph("body", "11"))).toBe("date");
    expect(placeholderRole(ph("body", "12"))).toBe("footer");
    expect(placeholderRole(ph("body", "15"))).toBe("title");
    expect(placeholderRole(ph("body", "16"))).toBe("subtitle");
  });

  it("title/subtitle/body types are unchanged", () => {
    expect(placeholderRole(ph("ctrTitle", "0"))).toBe("title");
    expect(placeholderRole(ph("subTitle", "1"))).toBe("subtitle");
    expect(placeholderRole(ph("body", "1"))).toBe("body");
  });
});

// AI-Import P1 (docs/design/ai-import.md §4-A): a body-TYPED placeholder that sits as a thin strip in
// the footer band is a design/meta element (rule / footer / label), NOT content — audited templates
// carried e.g. body@30(0.5,6.7 12.3×0.3) as "body" on EVERY layout, inflating bodyCount + skewing
// column detection. Reclassify by GEOMETRY, gated to the unambiguous footer band so real content bodies
// (taller / higher) are never touched.
describe("placeholderRole: geometry-based meta detection for footer-band body placeholders", () => {
  const META = new Set(["footer", "date", "slideNumber"]);
  const phg = (type: string, idx: string, g: { x: number; y: number; w: number; h: number }): PlaceholderInfo => ({
    idx, type, name: "", shapeXml: "",
    style: { ...g, fontSize: 12, fontColor: "000000", fontName: "Calibri", bold: false, align: "l", bulletChar: "" },
  });

  it("a full-width thin strip at the bottom (body@30) is META, not body", () => {
    expect(META.has(placeholderRole(phg("body", "30", { x: 0.5, y: 6.7, w: 12.3, h: 0.3 })))).toBe(true);
  });

  it("a footer-band source/note strip (body@14) is META, not body", () => {
    expect(META.has(placeholderRole(phg("body", "14", { x: 0.6, y: 6.5, w: 12.1, h: 0.6 })))).toBe(true);
  });

  it("a real CONTENT body (tall, high) stays body", () => {
    expect(placeholderRole(phg("body", "1", { x: 0.6, y: 1.5, w: 12, h: 4 }))).toBe("body");
    expect(placeholderRole(phg("body", "2", { x: 8.6, y: 1.2, w: 4.3, h: 5.6 }))).toBe("body"); // a column body
  });

  it("a short body just ABOVE the footer band (y<6.15) is NOT reclassified (gate is tight)", () => {
    expect(placeholderRole(phg("body", "1", { x: 1, y: 6.0, w: 2, h: 0.4 }))).toBe("body");
  });

  it("a body with inherited (zero) geometry is untouched — no geometry to judge", () => {
    expect(placeholderRole(phg("body", "7", { x: 0, y: 0, w: 0, h: 0 }))).toBe("body");
  });
});
