/**
 * prompt-invariants.test.ts — slice 4 of the AI-quality theme: the prompt layer's structure /
 * fact / language preservation guidance. The DETERMINISTIC harness (reconcileEdit / validateStructure)
 * is the final guarantee; these prompt invariants exist to REDUCE how often the model drops structure
 * in the first place (fewer retries, cleaner front-facing edits). They lock in the guidance so a later
 * edit can't silently remove it.
 */
import { describe, it, expect } from "vitest";
import { slideMarkdownEditPrompt, slideCondensePrompt } from "../src/engine/deck-plan-prompts";

describe("slideMarkdownEditPrompt — structure preservation + dual-mode decision tree", () => {
  const p = slideMarkdownEditPrompt();

  it("instructs echoing the layout header verbatim and keeping title/meta/fences", () => {
    expect(p).toContain("<!-- slide: LayoutName -->");
    expect(p).toContain("保持する不変条件");
    expect(p).toContain("# 見出し"); // the title is named as a thing to keep
    expect(p).toMatch(/Category:.*Date:.*Footer:/s); // meta rows named
  });

  it("preserves numbers/proper-nouns verbatim and keeps the input language", () => {
    expect(p).toContain("逐語");
    expect(p).toMatch(/言語を保つ|同じ言語/);
  });

  it("gives an A/B decision tree that defaults to (A) when in doubt", () => {
    expect(p).toMatch(/When in doubt, choose \(A\)|迷ったら/);
    expect(p).toContain("(A)");
    expect(p).toContain("(B)");
  });

  it("includes a few-shot whose output preserves the header + title (only the body condenses)", () => {
    // the example keeps the <!-- slide --> header and "# 課題" title, condensing only the bullet
    expect(p).toContain("情報共有の遅れ→全体遅延");
  });
});

describe("slideCondensePrompt — keeps the header + title too", () => {
  const p = slideCondensePrompt();
  it("preserves the layout header and the title through a condense", () => {
    expect(p).toContain("<!-- slide:");
    expect(p).toMatch(/# 見出し|タイトル/);
  });
});
