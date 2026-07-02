/**
 * export-slide-purge.test.ts — a picked master may be a FULL deck (an "all-layouts sample" .pptx
 * with baked-in slides), not a slide-free TemplateOnly file. generatePptx must strip the template's
 * own slides so the deck's slides are the ONLY slides — otherwise slide parts collide and their
 * [Content_Types] Overrides / presentation rels DUPLICATE (invalid OOXML → PowerPoint shows 0 slides).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { distillDeck } from "../src/engine/distill";
import { generatePptx } from "../src/engine/placeholder-filler";

const WITH_SLIDES = resolve(__dirname, "../public/templates/slide/報告書テンプレート_全レイアウト見本.pptx");
const SLIDE_FREE = resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx");
// This master's presentation.xml OMITS <p:sldIdLst> entirely (a hand-authored template) — the
// generatePptx sldIdLst-insert path must fire so exported slides are listed.
const NO_SLDIDLST = resolve(__dirname, "../public/templates/slide/lrk-slides-velis_CC0.pptx");
const MD = "# 表紙\n\n## サブ\n\n---\n\n# 本文\n\n- A\n- B\n\n---\n\n# まとめ\n\n- おわり";

async function assemble(tpl: TemplateData) {
  const deck = distillDeck(parseMd(MD), buildCatalog(tpl));
  const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
  const slides = Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f));
  const ct = await zip.file("[Content_Types].xml")!.async("string");
  const overrides = ct.match(/PartName="\/ppt\/slides\/slide\d+\.xml"/g) ?? [];
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  const sldIds = (pres.match(/<p:sldId /g) ?? []).length;
  return { deckLen: deck.slides.length, slides: slides.length, overrides, sldIds };
}

describe("generatePptx purges the template's baked-in slides", () => {
  it("a template WITH 13 sample slides exports ONLY the deck's slides, no duplicate Overrides", async () => {
    const tpl = await loadTemplate(readFileSync(WITH_SLIDES));
    const r = await assemble(tpl);
    expect(r.deckLen).toBeGreaterThan(0);
    expect(r.slides).toBe(r.deckLen); // exactly the deck's slides — the 13 baked ones are gone
    expect(r.sldIds).toBe(r.deckLen); // sldIdLst matches
    expect(r.overrides.length).toBe(r.deckLen);
    expect(new Set(r.overrides).size).toBe(r.overrides.length); // no duplicate slide Overrides
  });

  it("a slide-free TemplateOnly master still exports cleanly (no regression)", async () => {
    const tpl = await loadTemplate(readFileSync(SLIDE_FREE));
    const r = await assemble(tpl);
    expect(r.slides).toBe(r.deckLen);
    expect(r.sldIds).toBe(r.deckLen);
    expect(new Set(r.overrides).size).toBe(r.overrides.length);
  });

  it("a master whose presentation.xml OMITS sldIdLst still lists every slide (not 1 blank)", async () => {
    // Regression: without an inserted <p:sldIdLst>, the deck's slide parts exist but the presentation
    // references none → PowerPoint/LibreOffice show a single blank default slide.
    const tpl = await loadTemplate(readFileSync(NO_SLDIDLST));
    const r = await assemble(tpl);
    expect(r.deckLen).toBeGreaterThan(1);
    expect(r.slides).toBe(r.deckLen);
    expect(r.sldIds).toBe(r.deckLen); // sldIdLst was inserted + populated
  });
});
