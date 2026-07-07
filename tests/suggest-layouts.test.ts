/**
 * suggest-layouts.test.ts — theme 4: surface what "Auto" resolved to + a few alternative layouts.
 * suggestLayouts returns ranked candidate names: the auto-resolved layout FIRST (so the editor can
 * show "Auto → X"), then the best alternatives (same role first, then by body-region fit).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, suggestLayouts, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";

const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");
const content = () => parseMd("# 本日のアジェンダ\n\n- A\n- B\n- C").slides[0];

describe("suggestLayouts", () => {
  let tpl: TemplateData;
  let cat: LayoutCatalog;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(REPORT)); cat = buildCatalog(tpl); });

  it("the FIRST suggestion equals autoSelectLayout (consistency)", () => {
    const s = content();
    expect(suggestLayouts(s, 1, 5, cat, 4)[0]).toBe(autoSelectLayout({ ...s, layout: "auto" }, 1, 5, cat));
  });

  it("returns up to `limit` DISTINCT candidates, with real alternatives", () => {
    const sug = suggestLayouts(content(), 1, 5, cat, 4);
    expect(sug.length).toBeGreaterThan(1); // not just the auto pick
    expect(sug.length).toBeLessThanOrEqual(4);
    expect(new Set(sug).size).toBe(sug.length); // distinct
    for (const name of sug) expect(cat.some((e) => e.name === name)).toBe(true); // all real layouts
  });

  it("a first-slide title → the cover ranks first", () => {
    const s = parseMd("# 表紙\n## サブ").slides[0];
    const sug = suggestLayouts(s, 0, 5, cat);
    expect(cat.find((e) => e.name === sug[0])?.role).toBe("title");
  });

  it("returns [] when there is no catalog (no template loaded)", () => {
    expect(suggestLayouts(content(), 1, 5, undefined)).toEqual([]);
  });

  it("even a PINNED slide gets suggestions computed as-if Auto (so alternatives are offered)", () => {
    const s = { ...content(), layout: "05_比較表" };
    const sug = suggestLayouts(s, 1, 5, cat, 4);
    expect(sug[0]).toBe(autoSelectLayout({ ...s, layout: "auto" }, 1, 5, cat)); // ignores the pin
  });
});
