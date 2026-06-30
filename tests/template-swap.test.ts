/**
 * template-swap.test.ts — does the tool REALLY work when you swap to an arbitrary (alien) master?
 * The canonical template (Midnight_Executive_30) names layouts "Title.1Title.Single" etc., which
 * deck-plan.slidePlanToSlide HARDCODES. The alien template (lrk-slides-velis_CC0) uses totally
 * different names ("Presentation Title", "Title and Content", "Two Columns", "Close"). This proves
 * autoSelectLayout (the resolution chokepoint in every render/export path) DEGRADES the hardcoded
 * names to role-matched alien layouts instead of dangling, so generation never breaks on a BYO master.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { distillDeck } from "../src/engine/distill";
import { generatePptx } from "../src/engine/placeholder-filler";
import { deckPlanToDeck, type DeckPlan } from "../src/engine/deck-plan";
import JSZip from "jszip";

async function slideText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => /ppt\/slides\/slide\d+\.xml$/.test(n));
  return (await Promise.all(names.map((n) => zip.files[n].async("string")))).join("");
}

const dir = "../public/templates/slide/";
async function load(f: string): Promise<{ template: TemplateData; catalog: LayoutCatalog }> {
  const template = await loadTemplate(readFileSync(resolve(__dirname, dir + f)));
  return { template, catalog: buildCatalog(template) };
}
const isPptx = (b: Uint8Array) => b.length > 1000 && b[0] === 0x50 && b[1] === 0x4b; // PK zip magic

const SAMPLE_MD =
  "# 表紙\n\n## サブ\n\n---\n\n# 中身\n\n- 速度: 0.8秒\n- 重量: 1.2kg\n- 価格: 1000円\n\n---\n\n# 図\n\n```mermaid\nflowchart TD\n  A[開始]-->B[処理]-->C[終了]\n```\n\n---\n\n# まとめ\n\n- ありがとうございました";

const PLAN: DeckPlan = {
  slides: [
    { kind: "title", title: "表紙", subtitle: "サブ" },
    { kind: "content", title: "中身", bullets: ["速度: 0.8秒", "重量: 1.2kg"] },
    { kind: "columns", title: "比較", columns: [{ heading: "A案", bullets: ["a1", "a2"] }, { heading: "B案", bullets: ["b1"] }] },
    { kind: "diagram", title: "構成図", mermaid: "flowchart TD\n  A[開始]-->B[終了]" },
    { kind: "closing", title: "ありがとうございました" },
  ],
};

let alien: { template: TemplateData; catalog: LayoutCatalog };
let canon: { template: TemplateData; catalog: LayoutCatalog };
beforeAll(async () => {
  alien = await load("lrk-slides-velis_CC0.pptx");
  canon = await load("Midnight_Executive_30_TemplateOnly.pptx");
});

describe("template swap — works on an ALIEN master (different layout names)", () => {
  it("the alien template is genuinely alien: none of the hardcoded canonical names exist in it", () => {
    const names = new Set(alien.catalog.map((e) => e.name));
    for (const n of ["Title.1Title.Single", "Content.1Body.Single", "Column.2Body.Equal", "Closing.1Message.Single"]) {
      expect(names.has(n)).toBe(false);
    }
    expect(alien.catalog.length).toBeGreaterThan(5);
  });

  it("MARKDOWN path (role-based autoSelectLayout) exports a valid PPTX, all layouts exist in the alien template", async () => {
    const deck = distillDeck(parseMd(SAMPLE_MD), alien.catalog);
    const bytes = await generatePptx(deck, alien.template);
    expect(isPptx(bytes)).toBe(true);
    const names = new Set(alien.catalog.map((e) => e.name));
    deck.slides.forEach((s, i) => {
      const resolved = s.layout === "auto" ? autoSelectLayout(s, i, deck.slides.length, alien.catalog) : s.layout;
      expect(names.has(resolved)).toBe(true);
    });
    // the actual CONTENT survives the alien-layout placeholder mapping (role-based, not idx-blind)
    const text = await slideText(bytes);
    for (const t of ["表紙", "中身", "速度", "まとめ"]) expect(text).toContain(t);
  });

  it("DECKPLAN path (HARDCODED canonical names) DEGRADES — no crash, valid PPTX, names resolve to existing alien layouts", async () => {
    const deck = deckPlanToDeck(PLAN);
    expect(deck.slides.some((s) => s.layout === "Title.1Title.Single")).toBe(true); // carries names absent from the alien master
    const bytes = await generatePptx(deck, alien.template);
    expect(isPptx(bytes)).toBe(true);
    const names = new Set(alien.catalog.map((e) => e.name));
    deck.slides.forEach((s, i) => {
      const resolved = autoSelectLayout(s, i, deck.slides.length, alien.catalog);
      expect(names.has(resolved)).toBe(true); // degraded to a REAL alien layout, not the dangling canonical name
    });
  });

  it("sanity: the same DeckPlan also exports on the canonical template (names match natively)", async () => {
    const bytes = await generatePptx(deckPlanToDeck(PLAN), canon.template);
    expect(isPptx(bytes)).toBe(true);
  });
});
