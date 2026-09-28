/**
 * body-visual-coexist.test.ts — #390: body text (bullets) + a table, or body text + a code block, on
 * ONE slide used to lose the body silently: the table/code stayed at body ordinal 1, the SAME region
 * the bullets bind to, and the export skips (table) / overwrites (code) that placeholder. A diagram
 * already moves to ordinal 2 beside the bullets; this locks the same treatment for table/code, the
 * layout pick that gives it a 2nd body region, and a never-silent diagnostic for any residual case
 * where bound body text lands in a placeholder a visual occupies.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { generatePptx } from "../src/engine/placeholder-filler";
import { bodyPlaceholders, nthBody } from "../src/engine/visual-placement";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";
import type { DeckIR } from "../src/engine/slide-schema";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

// The issue's repro, verbatim.
const TABLE_MD = "# S2 箇条書きと表\n\n- 計測は本番環境で実施\n- 目標値はすべて達成\n\n| 項目 | 値 |\n|---|---|\n| 応答時間 | 120ms |";
const CODE_MD = "# S3 箇条書きとログ\n\n- 計測は本番環境で実施\n- 目標値はすべて達成\n\n```log\nERROR timeout at 12:00\nretry ok\n```";

const EMU = (inches: number) => Math.round(inches * 914400);

describe("parser — table/code beside body text moves to body ordinal 2 (#390)", () => {
  it("table + bullets → table at idx 2, bullets stay at idx 1", () => {
    const s = parseMd(TABLE_MD).slides[0];
    expect(s.table?.placeholderIdx).toBe("2");
    expect(JSON.stringify(s.placeholders.find((p) => p.idx === "1"))).toContain("計測は本番環境で実施");
  });

  it("code + bullets → code at idx 2, bullets stay at idx 1", () => {
    const s = parseMd(CODE_MD).slides[0];
    expect(s.code?.placeholderIdx).toBe("2");
    expect(JSON.stringify(s.placeholders.find((p) => p.idx === "1"))).toContain("目標値はすべて達成");
  });

  it("a table / code block WITHOUT body text stays at idx 1 (unchanged)", () => {
    expect(parseMd("# T\n\n| a | b |\n|---|---|\n| 1 | 2 |").slides[0].table?.placeholderIdx).toBe("1");
    expect(parseMd("# T\n\n```log\nx\n```").slides[0].code?.placeholderIdx).toBe("1");
  });

  it("a TITLE-namespace slide (idx 1 = subtitle, not body) keeps its table at idx 1 (unchanged)", () => {
    const s = parseMd("# 表紙\n\n## サブ\n\nDate: 2026-09-28\n\n| a | b |\n|---|---|\n| 1 | 2 |").slides[0];
    expect(s.table?.placeholderIdx).toBe("1");
  });
});

describe("Midnight export — body text AND the table/code both render (#390)", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(MIDNIGHT));
    catalog = buildCatalog(tpl);
  });

  /** The resolved layout's 2nd body region for slide 0 of `deck` (the box the visual must sit in). */
  function secondRegion(deck: DeckIR) {
    const name = autoSelectLayout(deck.slides[0], 0, deck.slides.length, catalog);
    const layout = tpl.layouts.find((l) => l.name === name)!;
    return nthBody(bodyPlaceholders(layout.placeholders), "2");
  }

  async function slide1Xml(deck: DeckIR): Promise<string> {
    const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
    return zip.file("ppt/slides/slide1.xml")!.async("string");
  }

  it("table: bullets AND the native table are in the slide XML; the table sits in the 2nd body region's box", async () => {
    const deck = parseMd(TABLE_MD);
    const region = secondRegion(deck);
    expect(region).toBeDefined(); // the auto layout offers a 2nd body region
    const xml = await slide1Xml(deck);
    expect(xml).toContain("計測は本番環境で実施");
    expect(xml).toContain("目標値はすべて達成");
    expect(xml).toContain("<a:tbl>");
    expect(xml).toContain("応答時間");
    const s = region!.style;
    expect(xml).toContain(`<p:xfrm><a:off x="${EMU(s.x)}" y="${EMU(s.y)}"/><a:ext cx="${EMU(s.w)}" cy="${EMU(s.h)}"/></p:xfrm>`);
  });

  it("code: bullets AND the code text are in the slide XML; the code fills the 2nd body placeholder", async () => {
    const deck = parseMd(CODE_MD);
    const region = secondRegion(deck);
    expect(region).toBeDefined();
    const xml = await slide1Xml(deck);
    expect(xml).toContain("計測は本番環境で実施");
    expect(xml).toContain("目標値はすべて達成");
    expect(xml).toContain("ERROR timeout at 12:00");
    // the <p:sp> carrying the code text is the 2nd body placeholder (by its layout idx)
    const codeShape = xml.split("<p:sp>").find((sp) => sp.includes("ERROR timeout at 12:00"))!;
    expect(codeShape).toMatch(new RegExp(`<p:ph[^>]*idx="${region!.idx}"`));
  });

  it("diagnoseDeck reports nothing hidden for the fixed decks", () => {
    for (const md of [TABLE_MD, CODE_MD]) {
      const issues = diagnoseDeck(parseMd(md), catalog, tpl.layouts);
      expect(issues.filter((i) => i.id === "visual-shadowed-content")).toEqual([]);
    }
  });

  it("never-silent: body text bound to the SAME placeholder a table occupies is reported (warn)", () => {
    // A hand-built / legacy IR (e.g. from JSON) that still has the table at ordinal 1 beside bullets.
    const deck = parseMd(TABLE_MD);
    deck.slides[0] = { ...deck.slides[0], table: { ...deck.slides[0].table!, placeholderIdx: "1" } };
    const issues = diagnoseDeck(deck, catalog, tpl.layouts).filter((i) => i.id === "visual-shadowed-content");
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(0);
    expect(issues[0].level).toBe(REVIEW_RULES.find((r) => r.id === "visual-shadowed-content")!.level);
  });

  it("never-silent: body text overwritten by a code block at the same ordinal is reported", () => {
    const deck = parseMd(CODE_MD);
    deck.slides[0] = { ...deck.slides[0], code: { ...deck.slides[0].code!, placeholderIdx: "1" } };
    const issues = diagnoseDeck(deck, catalog, tpl.layouts).filter((i) => i.id === "visual-shadowed-content");
    expect(issues).toHaveLength(1);
  });
});

describe("slideRoleRegions — every visual's ordinal counts (#390 fix 2)", () => {
  // col 1 = a table, col 2 = a diagram, NO body text. Reading only the FIRST visual's ordinal (the old
  // `??` chain picked the diagram's "2") missed the table at "1" → hasBody false → misread as a
  // SECTION slide. Counting all ordinals classifies it as 2 columns.
  const MD = "# 表と図\n\n<!-- col -->\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<!-- col -->\n```diagram\ntype: flowchart\nnodes:\n  - id: n1\n    label: N1\n```";

  it("parses as table@1 + diagram@2 with no body text", () => {
    const s = parseMd(MD).slides[0];
    expect(s.table?.placeholderIdx).toBe("1");
    expect(s.diagram?.placeholderIdx).toBe("2");
    expect(s.placeholders.some((p) => p.idx === "1" || p.idx === "2")).toBe(false);
  });

  it("no catalog → the canonical 2-column fallback, not the section layout", () => {
    expect(autoSelectLayout(parseMd(MD).slides[0], 1, 3)).toBe("Column.2Body.Equal");
  });

  it("Midnight → a layout with 2 body regions (both visuals get a home)", async () => {
    const tpl = await loadTemplate(readFileSync(MIDNIGHT));
    const name = autoSelectLayout(parseMd(MD).slides[0], 1, 3, buildCatalog(tpl));
    expect(name).toBe("Column.2Body.Equal");
    const layout = tpl.layouts.find((l) => l.name === name)!;
    expect(bodyPlaceholders(layout.placeholders).length).toBeGreaterThanOrEqual(2);
  });
});
