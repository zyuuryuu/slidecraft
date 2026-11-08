/**
 * prompt-invariants.test.ts — slice 4 of the AI-quality theme: the prompt layer's structure /
 * fact / language preservation guidance. The DETERMINISTIC harness (reconcileEdit / validateStructure)
 * is the final guarantee; these prompt invariants exist to REDUCE how often the model drops structure
 * in the first place (fewer retries, cleaner front-facing edits). They lock in the guidance so a later
 * edit can't silently remove it.
 */
import { describe, it, expect } from "vitest";
import { slideMarkdownEditPrompt, slideCondensePrompt, slideEditUserPrompt } from "../src/engine/deck-plan-prompts";
import { parseFieldEditOps } from "../src/engine/field-edit-ops";
import { parseDataEditOps } from "../src/engine/chart-edit-ops";
import { parseDiagramEditOps } from "../src/engine/diagram-edit-ops";
import { parseDesignIntent } from "../src/engine/design-intent";

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

  it("routes existing-figure node/edge edits to (B) ops (no anti-ops 'when in doubt (A)' default)", () => {
    expect(p).toContain("(A)");
    expect(p).toContain("(B)");
    // L5 (ADR-0019): the old "when in doubt → (A)" default biased weak models OFF the deterministic ops
    // path (T2 oscillation). It's replaced by "prefer (B) for any change to an existing figure".
    expect(p).not.toMatch(/When in doubt, choose \(A\)/);
    expect(p).toMatch(/NODE or EDGE inside an existing figure is \(B\), NOT \(A\)/);
    expect(p).toMatch(/Prefer \(B\)/);
  });

  it("teaches safe deletion: emit the EXACT named id, never a nearby substitute", () => {
    // L5 (delete-safety at source, T4a): a weak model told to delete an absent node must NOT fuzzy-match
    // to a nearby one — it emits the exact id and the engine skips+reports it.
    expect(p).toMatch(/EXACT id/);
    expect(p).toMatch(/NEVER substitute/);
    const delFewShot = '[{"op":"removeNode","id":"cache"}]';
    expect(p).toContain(delFewShot); // the deletion few-shot
    expect(parseDiagramEditOps(delFewShot)).not.toBeNull(); // and it parses via the real engine
  });

  it("includes a few-shot whose output preserves the header + title (only the body condenses)", () => {
    // the example keeps the <!-- slide --> header and "# 課題" title, condensing only the bullet
    expect(p).toContain("情報共有の遅れ→全体遅延");
  });

  it("offers figure CONTENT ops (部分生成・ADR-0019) whose example parses via the real engine parser", () => {
    for (const op of ["nodeUpdate", "addNode", "removeNode", "edgeUpdate", "addEdge", "removeEdge", "setDirection"]) {
      expect(p).toContain(op);
    }
    // the embedded (B) content-ops example MUST be consumable by applyDiagramEditOps's parser — this
    // gate keeps the prompt example and the engine that applies it from drifting apart.
    const example = '[{"op":"nodeUpdate","id":"db","label":"PostgreSQL"},{"op":"addNode","id":"cache","label":"Redis"},{"op":"addEdge","from":"db","to":"cache"}]';
    expect(p).toContain(example);
    expect(parseDiagramEditOps(example)).not.toBeNull();
    expect(parseDesignIntent(example)).toBeNull(); // content ops are NOT design ops (disjoint routing)
  });

  it("offers placeholder TEXT ops (setField・#106 P2) for wording-only edits, with an example the engine parses", () => {
    expect(p).toContain("setField");
    expect(p).toMatch(/wording/i); // the selector names when setField applies
    const example = '[{"op":"setField","idx":"15","text":"売上の推移（2026年度）"}]';
    expect(p).toContain(example);
    expect(parseFieldEditOps(example)).not.toBeNull();
    expect(parseDiagramEditOps(example)).toBeNull(); // disjoint from figure ops
    expect(parseDesignIntent(example)).toBeNull(); // and from design ops
  });

  it("setField is offered ONLY when a Fields list is given (batch edit sends none and parses Markdown only)", () => {
    // batchEditDeck (refine.ts) reuses this prompt but its request has no "Fields" list and its output is
    // parsed as Markdown — ops wiring there is #106 P4. Until then the prompt must steer it to (A).
    expect(p).toMatch(/no "Fields" list.*\(A\)/);
  });

  it("offers DATA ops (#106 P3: table cell / chart value / gantt task / KPI card) with an example the engine parses", () => {
    for (const op of ["setCell", "setSeriesValue", "setTask", "setCard"]) expect(p).toContain(op);
    const example = '[{"op":"setSeriesValue","series":"売上","index":1,"value":25}]';
    expect(p).toContain(example);
    expect(parseDataEditOps(example)).not.toBeNull();
    expect(parseFieldEditOps(example)).toBeNull(); // disjoint from TEXT ops
    expect(parseDiagramEditOps(example)).toBeNull(); // from figure CONTENT ops
    expect(parseDesignIntent(example)).toBeNull(); // and from design ops
    expect(p).toMatch(/row 0 = header/); // the table addressing is stated, as the Data list shows it
  });

  it("DATA ops are offered ONLY when a Data list is given (batch edit sends none and parses Markdown only)", () => {
    expect(p).toMatch(/no "Data" list.*\(A\)/);
  });

  it("still offers arrangement (design) ops that route to parseDesignIntent", () => {
    expect(p).toContain("regionSplit");
    expect(parseDesignIntent('[{"op":"relayout","direction":"LR"}]')).not.toBeNull();
    expect(parseDiagramEditOps('[{"op":"relayout","direction":"LR"}]')).toBeNull(); // design op ≠ content op
  });
});

describe("slideEditUserPrompt — the per-slide request carries the setField idx list", () => {
  it("includes the slide Markdown, the field list, and the instruction", () => {
    const u = slideEditUserPrompt("# 売上\n- a", '- idx "15": "売上"', "タイトルを変えて");
    expect(u).toContain("Current slide:\n# 売上\n- a");
    expect(u).toContain('- idx "15": "売上"');
    expect(u).toContain("Instruction: タイトルを変えて");
  });
  it("without fields it is exactly the previous request shape", () => {
    expect(slideEditUserPrompt("# 売上", "", "x")).toBe("Current slide:\n# 売上\n\nInstruction: x");
  });
});

describe("slideEditUserPrompt — the per-slide request carries the DATA listing (#106 P3)", () => {
  it("appends the Data listing after the Fields list", () => {
    const u = slideEditUserPrompt("# 売上", '- idx "15": "売上"', "Q2 を 25 に", '- series 0 "売上": [10,20,30]');
    expect(u).toContain('Data:\n- series 0 "売上": [10,20,30]');
    expect(u.indexOf("Fields")).toBeLessThan(u.indexOf("Data:"));
    expect(u.endsWith("Instruction: Q2 を 25 に")).toBe(true);
  });
  it("without data it is exactly the P2 request (slides with no table/chart are unchanged)", () => {
    expect(slideEditUserPrompt("# 売上", '- idx "15": "売上"', "x", "")).toBe(slideEditUserPrompt("# 売上", '- idx "15": "売上"', "x"));
  });
});

describe("slideCondensePrompt — keeps the header + title too", () => {
  const p = slideCondensePrompt();
  it("preserves the layout header and the title through a condense", () => {
    expect(p).toContain("<!-- slide:");
    expect(p).toMatch(/# 見出し|タイトル/);
  });
});
