/**
 * slide-fix.test.ts — the "制約＋診断 ⇄ AI" contract: diagnostics + budget →
 * a structured fix packet + the AI "slide"-mode request it serializes to.
 */
import { describe, it, expect } from "vitest";
import { buildSlideFix, slideFixRequest } from "../src/engine/slide-fix";
import type { DeckIssue } from "../src/engine/deck-diagnostics";

const issue = (message: string, levers: DeckIssue["levers"]): DeckIssue => ({
  slideIndex: 0, title: "T", level: "info", message, levers,
});

describe("buildSlideFix", () => {
  it("composes an instruction from the union of levers + the template budget", () => {
    const fix = buildSlideFix(
      "# T\n\n- a\n- b",
      [issue("長い箇条書き 1件", ["condense"]), issue("key-value形式", ["visualize"])],
      { charsPerLine: 20, maxLines: 6 },
    );
    expect(fix.budget).toEqual({ maxBullets: 6, charsPerBullet: 20 });
    expect(fix.instruction).toContain("キーフレーズ");
    expect(fix.instruction).toContain("20字以内");
    expect(fix.instruction).toContain("表（");
    expect(fix.instruction).toContain("最大6項目");
    // the non-destruction guard is always present
    expect(fix.instruction).toContain("言い換えは最小限");
    expect(fix.issues).toHaveLength(2);
  });

  it("works without a template (no budget → no char/item limits)", () => {
    const fix = buildSlideFix("- a", [issue("タイトルが無い", ["title"])]);
    expect(fix.budget).toBeUndefined();
    expect(fix.instruction).toContain("タイトル");
    expect(fix.instruction).not.toContain("字以内");
  });

  it("serializes to the AI 'slide'-mode request shape (Current slide / Instruction)", () => {
    const fix = buildSlideFix("# T\n\n- a", [issue("超過", ["split"])]);
    const req = slideFixRequest(fix);
    expect(req).toBe(`Current slide:\n# T\n\n- a\n\nInstruction: ${fix.instruction}`);
    expect(fix.instruction).toContain("最重要点");
  });
});
