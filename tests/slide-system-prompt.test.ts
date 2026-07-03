/**
 * slide-system-prompt.test.ts — #1: the manual-copy slide prompt must advertise the ACTUAL template's
 * layouts, not the canonical set. On an alien master those canonical names ("Content.1Body.Single" …)
 * don't exist, so the pasted-to-external-LLM prompt was misleading. Given a catalog, the layout list +
 * the role-based selection rules are built from the master's REAL layout names ([[guardrail_any_template]]);
 * with no catalog it falls back to the canonical names.
 */
import { describe, it, expect } from "vitest";
import { slideSystemPrompt } from "../src/engine/llm-prompts";
import type { LayoutCatalog } from "../src/engine/template-catalog";

const alien: LayoutCatalog = [
  { name: "Cover_Big", role: "title", bodyCount: 0, hasTitle: true, hasSubtitle: true, placeholders: [] },
  { name: "Divider_X", role: "section", bodyCount: 0, hasTitle: true, hasSubtitle: false, placeholders: [] },
  { name: "Bullets_Plain", role: "content", bodyCount: 1, hasTitle: true, hasSubtitle: false, placeholders: [] },
  { name: "TwoUp", role: "columns", bodyCount: 2, hasTitle: true, hasSubtitle: false, placeholders: [] },
  { name: "TheEnd", role: "closing", bodyCount: 0, hasTitle: true, hasSubtitle: false, placeholders: [] },
];

describe("slideSystemPrompt — catalog-driven layout names (#1)", () => {
  it("lists the ALIEN template's real layouts and references them in the rules", () => {
    const p = slideSystemPrompt(alien);
    for (const name of ["Cover_Big", "Divider_X", "Bullets_Plain", "TwoUp", "TheEnd"]) {
      expect(p).toContain(name);
    }
    // the role-based selection rules point at the REAL names, not canonical ones the master lacks
    expect(p).not.toContain("Content.1Body.Single");
    expect(p).not.toContain("Closing.1Message.Single");
  });

  it("uses the real content/closing layouts in the selection rules", () => {
    const p = slideSystemPrompt(alien);
    // a content rule and a closing rule reference the alien names
    expect(p).toMatch(/Bullets_Plain/);
    expect(p).toMatch(/TheEnd/);
  });

  it("falls back to the canonical layout names when no catalog is given", () => {
    const p = slideSystemPrompt();
    expect(p).toContain("Content.1Body.Single");
    expect(p).toContain("Title.1Title.Single");
  });

  it("omits a rule for a role the template lacks (no invented layout)", () => {
    const titleOnly: LayoutCatalog = [
      { name: "OnlyCover", role: "title", bodyCount: 0, hasTitle: true, hasSubtitle: true, placeholders: [] },
    ];
    const p = slideSystemPrompt(titleOnly);
    expect(p).toContain("OnlyCover");
    // no canonical content/closing names leak in for roles this template doesn't have
    expect(p).not.toContain("Content.1Body.Single");
  });
});
