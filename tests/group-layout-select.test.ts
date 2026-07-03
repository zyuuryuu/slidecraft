/**
 * group-layout-select.test.ts — S4. A slide.groupKind slide must route to the matching GROUP layout
 * (card→10_カード3列, step→11_プロセス, kpi→09_KPIハイライト), preferring the group-count that fits.
 * NON-grouped slides must select EXACTLY as before (the group gate fires only on slide.groupKind).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import type { SlideIR } from "../src/engine/slide-schema";

const REPORT = resolve(__dirname, "../public/templates/slide/報告書テンプレート_全レイアウト見本.pptx");
const groups = (kind: "card" | "step" | "kpi", n: number): SlideIR => ({
  layout: "auto",
  groupKind: kind,
  placeholders: [
    { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
    ...Array.from({ length: n }, (_, i) => ({ idx: String(i + 1), paragraphs: [{ heading: true, segments: [{ text: `H${i}` }] }, { segments: [{ text: `B${i}` }] }] })),
  ],
});

describe("group-aware layout selection", () => {
  let tpl: TemplateData;
  let cat: LayoutCatalog;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(REPORT)); cat = buildCatalog(tpl); });

  it("buildCatalog tags grouped layouts with groupKind + groupCount", () => {
    const card = cat.find((e) => /^10_カード/.test(e.name))!;
    expect(card.groupKind).toBe("card");
    expect(card.groupCount).toBe(3);
    expect(cat.find((e) => /プロセス/.test(e.name))!.groupKind).toBe("step");
    expect(cat.find((e) => /KPI/.test(e.name))!.groupKind).toBe("kpi");
    // a plain content layout has no groupKind
    expect(cat.find((e) => /02_本文（1カラム）/.test(e.name))!.groupKind).toBeUndefined();
  });

  it("groupKind=card (3 groups) → 10_カード3列", () => {
    expect(autoSelectLayout(groups("card", 3), 1, 5, cat)).toBe("10_カード3列");
  });
  it("groupKind=step (4 groups) → 11_プロセス", () => {
    expect(autoSelectLayout(groups("step", 4), 1, 5, cat)).toBe("11_プロセス");
  });
  it("groupKind=kpi (3 groups) → 09_KPIハイライト", () => {
    expect(autoSelectLayout(groups("kpi", 3), 1, 5, cat)).toBe("09_KPIハイライト");
  });

  it("card with FEWER groups than the layout (2) still routes to 10_カード3列 (partial-fill)", () => {
    expect(autoSelectLayout(groups("card", 2), 1, 5, cat)).toBe("10_カード3列");
  });

  it("REGRESSION: a NON-grouped 2-column content slide is unchanged (does NOT pick a card layout)", () => {
    const s = parseMd("# 比較\n\n<!-- col -->\n**A**\n- a\n\n<!-- col -->\n**B**\n- b").slides[0];
    expect(s.groupKind).toBeUndefined();
    const picked = autoSelectLayout(s, 1, 5, cat);
    expect(picked).not.toBe("10_カード3列");
    expect(cat.find((e) => e.name === picked)?.groupKind).toBeUndefined(); // a plain (non-group) layout
  });
});
