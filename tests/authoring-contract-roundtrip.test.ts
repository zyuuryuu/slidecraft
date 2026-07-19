/**
 * authoring-contract-roundtrip.test.ts — Theme 3 / ⑥品質: the DRIFT GATE.
 *
 * The authoring guide is hand-written prose exposed to the upstream AI (get_authoring_guide /
 * get_diagram_guide). The cardinal rule of Theme 3 is "the contract must be a MIRROR of the engine's
 * real behavior, not aspirational" — a guide that teaches syntax the parser/schema doesn't accept makes
 * the AI author content the engine silently drops (the exact failure that let `notes` slip in). This
 * test locks the guide's CONCRETE EXAMPLES to engine truth: every taught example must actually parse.
 * See docs/design/mcp-brushup.md §H.
 */
import { describe, it, expect } from "vitest";
import { DIAGRAM_TYPES } from "../src/engine/diagram-type-prompts";
import { VALID_TYPES } from "../src/engine/schema-constants";
import { DiagramSpecSchema } from "../src/engine/schema";
import { slideSystemPrompt } from "../src/engine/llm-prompts";
import { parseMd } from "../src/engine/md-parser";

// ── L2: every diagram type's TAUGHT example must be a valid DiagramSpec OF THAT TYPE ──
describe("drift gate — L2 diagram examples parse (contract == engine truth)", () => {
  for (const type of VALID_TYPES) {
    it(`${type}: the shape's Example JSON validates and is type=${type}`, () => {
      const shape = DIAGRAM_TYPES[type].shape;
      const m = shape.match(/Example:\s*(\{[\s\S]*\})\s*$/);
      expect(m, `no "Example: {…}" JSON found in ${type} shape`).toBeTruthy();
      const spec = DiagramSpecSchema.parse(JSON.parse(m![1]));
      expect(spec.type).toBe(type);
    });
  }
});

// ── L1: the features the guide teaches (tables, code, region separators) must round-trip parse ──
describe("drift gate — L1 features the guide teaches actually parse", () => {
  it("the guide advertises tables and code", () => {
    const p = slideSystemPrompt();
    expect(p).toContain("## Tables");
    expect(p).toContain("## Code");
  });

  it("a GFM table body parses to a native table block", () => {
    const md = `<!-- slide: Content.1Body.Single -->\n# 指標\n\n| 指標 | 値 |\n| --- | --- |\n| 売上 | ¥1.2M |\n| 前年比 | +12% |\n`;
    const slide = parseMd(md).slides[0];
    expect(slide.table).toBeTruthy();
    expect(slide.table!.rows.length).toBe(3); // header + 2 data rows
  });

  it("a fenced code block parses to a code block with its language", () => {
    const md = "<!-- slide: Content.1Body.Single -->\n# コード\n\n```python\ndef greet(name):\n    return name\n```\n";
    const slide = parseMd(md).slides[0];
    expect(slide.code).toBeTruthy();
    expect(slide.code!.lang).toBe("python");
  });

  it("the guide advertises speaker notes, and the taught <!-- note --> example actually parses (#150)", () => {
    const p = slideSystemPrompt();
    expect(p).toContain("## Speaker Notes");
    expect(p).toContain("<!-- note -->");
    // The taught form: marker on its own line, everything after = notes (plain Markdown).
    const md = "# Slide Title\n\n- Key point only\n\n<!-- note -->\nFull explanation the presenter reads aloud.\n- supporting detail\n";
    const slide = parseMd(md).slides[0];
    expect(slide.notes).toBeTruthy();
    expect(slide.notes!.map((n) => n.segments.map((s) => s.text).join(""))).toEqual([
      "Full explanation the presenter reads aloud.",
      "supporting detail",
    ]);
  });

  it("<!-- col --> (one per column) splits the body into regions; content before the first is not a column", () => {
    // Each `<!-- col -->` LEADS a column (splitBySeparator skips pre-first-separator lines) — the
    // guide teaches "one per region", so the taught format has a separator before every column.
    const md = "<!-- slide: Column.2Body.Equal -->\n# 比較\n\n<!-- col -->\n- 左1\n\n<!-- col -->\n- 右1\n";
    const slide = parseMd(md).slides[0];
    const idxs = slide.placeholders.map((p) => p.idx);
    expect(idxs).toContain("1");
    expect(idxs).toContain("2");
  });
});
