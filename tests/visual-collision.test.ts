/**
 * visual-collision.test.ts — #434: body text + a table + a figure on ONE slide puts the table AND the
 * figure at body ordinal 2 (#390 moves each beside the text independently), so both resolve to the
 * SAME placeholder: the PPTX draws them on top of each other, the preview shows only one, and
 * diagnoseDeck said nothing. Placement is unchanged here (the structural fix is #392); this locks
 * that the collision is REPORTED (warn `visual-collision`, lever split) and that it is derived from
 * the SAME placement resolution export uses (visualOccupancy, R8).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { visualCollisions, visualOccupancy } from "../src/engine/visual-placement";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

const TABLE = "|a|b|\n|---|---|\n|1|2|";
const SEQ = "```mermaid\nsequenceDiagram\n A->>B: x\n```";
const DIAG = "```diagram\nnodes:\n  - id: n1\n    label: N1\n```";
// The issue's minimal repro, verbatim (table → body text → mermaid).
const REPRO = `# T\n\n${TABLE}\n\n本文\n\n${SEQ}`;

describe("diagnoseDeck — visual-collision (#434)", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(MIDNIGHT));
    catalog = buildCatalog(tpl);
  });
  const collisions = (md: string) => diagnoseDeck(parseMd(md), catalog, tpl.layouts).filter((i) => i.id === "visual-collision");

  it("minimal repro (本文＋表＋図) → exactly 1 warn, lever split, naming both visuals", () => {
    const issues = collisions(REPRO);
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(0);
    expect(issues[0].title).toBe("T");
    expect(issues[0].level).toBe("warn");
    expect(issues[0].level).toBe(REVIEW_RULES.find((r) => r.id === "visual-collision")!.level);
    expect(issues[0].levers).toEqual(["split"]);
    expect(issues[0].message).toContain("表");
    expect(issues[0].message).toContain("図");
  });

  it("also fires for 本文＋表＋```diagram (same idx-2 collision)", () => {
    expect(collisions(`# T\n\n${TABLE}\n\n本文\n\n${DIAG}`)).toHaveLength(1);
  });

  it("also fires for 表＋図 with NO body text (both resolve to body ordinal 1)", () => {
    expect(collisions(`# T\n\n${TABLE}\n\n${SEQ}`)).toHaveLength(1);
  });

  it("placement is unchanged — the repro still binds table and figure to ordinal 2", () => {
    const s = parseMd(REPRO).slides[0];
    expect(s.table?.placeholderIdx).toBe("2");
    expect(s.diagram?.placeholderIdx).toBe("2");
  });

  // ── 負側：診断が増えないこと ──
  it("single visual (table only / figure only / 本文＋表 / 本文＋図) → 0", () => {
    for (const md of [`# T\n\n${TABLE}`, `# T\n\n${SEQ}`, `# T\n\n${DIAG}`, `# T\n\n本文\n\n${TABLE}`, `# T\n\n本文\n\n${SEQ}`]) {
      expect(collisions(md)).toEqual([]);
    }
  });

  it("explicit <!-- col --> split (表｜図) → 0", () => {
    expect(collisions(`# T\n\n<!-- col -->\n${TABLE}\n\n<!-- col -->\n${SEQ}`)).toEqual([]);
  });

  it("the whole issue-less deck stays issue-free (no other diagnostic appears)", () => {
    expect(diagnoseDeck(parseMd(`# T\n\n<!-- col -->\n${TABLE}\n\n<!-- col -->\n${SEQ}`), catalog, tpl.layouts)).toEqual([]);
  });

  it("2-arg diagnoseDeck (no template) is unchanged — the check needs the resolved layout", () => {
    expect(diagnoseDeck(parseMd(REPRO)).filter((i) => i.id === "visual-collision")).toEqual([]);
  });

  // ── R8: the collision is read off the SAME claims visualOccupancy is built from ──
  it("agreement: every colliding placeholder is one visualOccupancy reports as occupied", () => {
    for (const md of [REPRO, `# T\n\n${TABLE}\n\n${SEQ}`]) {
      const s = parseMd(md).slides[0];
      const layout = tpl.layouts.find((l) => l.name === autoSelectLayout(s, 0, 1, catalog))!;
      const occ = visualOccupancy(s, layout.placeholders);
      const col = visualCollisions(s, layout.placeholders);
      expect(col).toHaveLength(1);
      expect(occ.has(col[0].idx)).toBe(true);
      expect(col[0].kinds).toContain(occ.get(col[0].idx));
      expect([...col[0].kinds].sort()).toEqual(["diagram", "table"]);
    }
  });
});
