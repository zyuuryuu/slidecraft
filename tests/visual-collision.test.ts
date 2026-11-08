/**
 * visual-collision.test.ts — #434: body text + a table + a figure on ONE slide put the table AND the
 * figure at body ordinal 2 (#390 moves each beside the text independently), so both resolved to the
 * SAME placeholder: the PPTX drew them on top of each other, the preview showed only one, and
 * diagnoseDeck said nothing. #434 made that REPORTED (warn `visual-collision`, lever split).
 *
 * #392 段 2 fixed the placement itself (figure-placement gives each visual its own ordinal), so 本文＋表＋図
 * and 表＋図 no longer collide — locked below. The rule stays for what can still collide: two ordinals a
 * layout maps to ONE box (two images on a layout with one picture frame — imagePlaceholder clamps to it).
 * It is derived from the SAME placement resolution export uses (visualOccupancy, R8).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { visualCollisions, visualOccupancy } from "../src/engine/visual-placement";
import { placedFigures } from "../src/engine/figure-placement";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const PITCH = resolve(__dirname, "../public/templates/slide/セールスピッチ_Pitch_TemplateOnly.pptx"); // Media.1Body+1Image: 1 picture frame
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
// Two images on a layout with ONE picture frame (pinned): ordinals 1 and 2 both clamp to that frame.
const TWO_IMAGES = `# T\n\n---\n\n<!-- slide: Media.1Body+1Image -->\n# 画像 2 枚\n\n![a](${PNG})\n\n![b](${PNG})\n`;

const TABLE = "|a|b|\n|---|---|\n|1|2|";
const SEQ = "```mermaid\nsequenceDiagram\n A->>B: x\n```";
const DIAG = "```diagram\nnodes:\n  - id: n1\n    label: N1\n```";
// The issue's minimal repro, verbatim (table → body text → mermaid).
const REPRO = `# T\n\n${TABLE}\n\n本文\n\n${SEQ}`;

describe("diagnoseDeck — visual-collision (#434)", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  let pitch: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(MIDNIGHT));
    catalog = buildCatalog(tpl);
    pitch = await loadTemplate(readFileSync(PITCH));
  });
  const collisions = (md: string) => diagnoseDeck(parseMd(md), catalog, tpl.layouts).filter((i) => i.id === "visual-collision");

  it("[#392 段 2] minimal repro (本文＋表＋図) → no collision any more: table and figure get their own regions", () => {
    expect(collisions(REPRO)).toEqual([]);
    const s = parseMd(REPRO).slides[0];
    const layout = tpl.layouts.find((l) => l.name === autoSelectLayout(s, 0, 1, catalog))!;
    expect([...visualOccupancy(s, layout.placeholders).values()].sort()).toEqual(["diagram", "table"]); // two placeholders
  });

  it("[#392 段 2] 本文＋表＋```diagram and 表＋図 with NO body text → no collision", () => {
    expect(collisions(`# T\n\n${TABLE}\n\n本文\n\n${DIAG}`)).toEqual([]);
    expect(collisions(`# T\n\n${TABLE}\n\n${SEQ}`)).toEqual([]);
  });

  it("the SlideIR is unchanged (both still stored at ordinal 2); figure-placement separates them at read time", () => {
    const s = parseMd(REPRO).slides[0];
    expect(s.table?.placeholderIdx).toBe("2");
    expect(s.diagram?.placeholderIdx).toBe("2");
    expect(placedFigures(s).map((p) => [p.figure.kind, p.ordinal])).toEqual([["table", "2"], ["diagram", "3"]]);
  });

  it("still fires where a layout maps two ordinals to ONE box (2 images, 1 picture frame) → 1 warn, lever split", () => {
    const issues = diagnoseDeck(parseMd(TWO_IMAGES), buildCatalog(pitch), pitch.layouts).filter((i) => i.id === "visual-collision");
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(1);
    expect(issues[0].title).toBe("画像 2 枚");
    expect(issues[0].level).toBe("warn");
    expect(issues[0].level).toBe(REVIEW_RULES.find((r) => r.id === "visual-collision")!.level);
    expect(issues[0].levers).toEqual(["split"]);
    expect(issues[0].message).toContain("画像");
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
    expect(diagnoseDeck(parseMd(TWO_IMAGES)).filter((i) => i.id === "visual-collision")).toEqual([]);
  });

  // ── R8: the collision is read off the SAME claims visualOccupancy is built from ──
  it("agreement: every colliding placeholder is one visualOccupancy reports as occupied", () => {
    const s = parseMd(TWO_IMAGES).slides[1];
    const layout = pitch.layouts.find((l) => l.name === autoSelectLayout(s, 1, 2, buildCatalog(pitch)))!;
    const occ = visualOccupancy(s, layout.placeholders);
    const col = visualCollisions(s, layout.placeholders);
    expect(col).toHaveLength(1);
    expect(occ.has(col[0].idx)).toBe(true);
    expect(col[0].kinds).toContain(occ.get(col[0].idx));
    expect(col[0].kinds).toEqual(["image", "image"]);
  });
});
