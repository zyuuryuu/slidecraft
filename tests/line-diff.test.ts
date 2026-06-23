/**
 * line-diff.test.ts — before→after line diff used to make AI edits reviewable.
 */
import { describe, it, expect } from "vitest";
import { lineDiff, diffStat } from "../src/engine/line-diff";

describe("lineDiff", () => {
  it("marks unchanged / dropped / added lines", () => {
    const rows = lineDiff("# T\n- a\n- b\n- c", "# T\n- a\n- c2");
    expect(rows).toEqual([
      { type: "same", text: "# T" },
      { type: "same", text: "- a" },
      { type: "del", text: "- b" },
      { type: "del", text: "- c" },
      { type: "add", text: "- c2" },
    ]);
  });

  it("surfaces a dropped line as a del with no matching add (the Omit case)", () => {
    const rows = lineDiff("- keep\n- 長い文章をそのまま\n- end", "- keep\n- end");
    expect(rows.some((r) => r.type === "del" && r.text.includes("長い文章"))).toBe(true);
    expect(diffStat(rows)).toEqual({ del: 1, add: 0 });
  });

  it("identical text → all same, no changes", () => {
    const rows = lineDiff("x\ny", "x\ny");
    expect(diffStat(rows)).toEqual({ del: 0, add: 0 });
    expect(rows.every((r) => r.type === "same")).toBe(true);
  });
});
