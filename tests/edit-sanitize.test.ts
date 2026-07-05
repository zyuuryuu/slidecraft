/**
 * edit-sanitize.test.ts — deterministic cleanup of a weak offline model's slide-EDIT output.
 * Fixtures are REAL phi-3.5 responses (reproduced via Ollama with the app's slide-edit prompt):
 * the model leaks the (A)/(B) format label, echoes the "Instruction:" line, and appends a
 * trailing "(Note: …)" prose note despite the prompt forbidding all three.
 */
import { describe, it, expect } from "vitest";
import { sanitizeSlideEditOutput } from "../src/engine/edit-sanitize";

describe("sanitizeSlideEditOutput (offline floor — harness over model)", () => {
  it("strips a leading (A)/(B) format label and a trailing parenthetical note", () => {
    const raw = [
      "A)",
      "# NextGen CRM プロジェクト",
      "## 移行計画レビュー",
      "Footer: Confidential",
      "",
      '(Note: The instruction "test" implies adding a bullet, but since it does not specify what to test, I added a generic one.)',
    ].join("\n");
    const out = sanitizeSlideEditOutput(raw);
    expect(out.startsWith("# NextGen CRM プロジェクト")).toBe(true); // label gone, real content first
    expect(out).not.toMatch(/\(Note/);
    expect(out).toContain("Footer: Confidential"); // real content preserved
  });

  it("preserves the <!-- slide --> header while stripping a trailing note", () => {
    const raw = [
      "<!-- slide: Title.1Title.Single -->",
      "# NextGen CRM プロジェクト",
      "Footer: 機密",
      "",
      '(Note: The footer "Confidential" was translated to "機密". The rest remains unchanged.)',
    ].join("\n");
    const out = sanitizeSlideEditOutput(raw);
    expect(out).toContain("<!-- slide: Title.1Title.Single -->"); // header must survive
    expect(out).not.toMatch(/\(Note/);
  });

  it("removes echoed Instruction: lines (heading form and trailing sentence)", () => {
    const raw = [
      "## Instruction: Test - The content remains",
      "# NextGen CRM プロジェクト",
      "Category: データ分析報告書",
      "Instruction: Test - The content remains unchanged as no specific alterations were requested.",
    ].join("\n");
    const out = sanitizeSlideEditOutput(raw);
    expect(out).not.toMatch(/Instruction\s*:/);
    expect(out).toContain("# NextGen CRM プロジェクト");
    expect(out).toContain("Category: データ分析報告書");
  });

  it("leaves a clean, already-valid edit untouched", () => {
    const clean = "<!-- slide: Content.1Body.Single -->\n# 課題\n- 情報共有の遅れ→全体遅延";
    expect(sanitizeSlideEditOutput(clean)).toBe(clean);
  });
});
