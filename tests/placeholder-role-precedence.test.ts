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
