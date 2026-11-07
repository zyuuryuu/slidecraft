/**
 * layout-augment-diagnostics.test.ts — #568 段 2: 診断は「N 列構造が無い → 強化で追加できる」と案内だけする。
 *
 * 規則 id `missing-column-layout`（info・REVIEW_RULES に登録 → #247 の on/off に乗る）。
 *  - 出る: 3 列スライドがあり、テンプレに columns×3 が無く、強化で足せる（元にするレイアウトがある）とき。
 *  - 出ない: 強化後のテンプレ / 3 列を元から持つテンプレ / layouts を渡さない呼び出し（refine の収束判定
 *    diagnoseDeck(deck, catalog) を変えない）/ 足せないテンプレ（案内しても押せないので出さない）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";
import { withoutDisabledRules } from "../src/engine/review-rule-toggle";
import { augmentAndVerify } from "../src/engine/layout-augment";
import { parseMd } from "../src/engine/md-parser";

const DIR = resolve(__dirname, "fixtures/templates");
const bytes = (f: string) => readFileSync(resolve(DIR, f));
const MD = "# 表紙\n\n---\n\n# 3 列\n\n<!-- col -->\n- a\n\n<!-- col -->\n- b\n\n<!-- col -->\n- c";
const ID = "missing-column-layout";

describe("diagnostic: missing-column-layout (guide only)", () => {
  it("is registered in REVIEW_RULES as info", () => {
    expect(REVIEW_RULES.find((r) => r.id === ID)?.level).toBe("info");
  });

  it("技術報告: a 3-column slide on a template without 3 columns → info pointing at 強化, naming the fallback", async () => {
    const tpl = await loadTemplate(bytes("技術報告_スタンダード水色_全レイアウト見本.pptx"));
    const cat = buildCatalog(tpl);
    const deck = parseMd(MD, cat);
    const hits = diagnoseDeck(deck, cat, tpl.layouts).filter((d) => d.id === ID);
    expect(hits).toHaveLength(1);
    expect(hits[0].slideIndex).toBe(1);
    expect(hits[0].level).toBe("info");
    expect(hits[0].message).toContain("3 列");
    expect(hits[0].message).toContain("強化");
    expect(hits[0].message).toContain(autoSelectLayout(deck.slides[1], 1, 2, cat));
    // #247 on/off
    expect(withoutDisabledRules(hits, new Set([ID]))).toEqual([]);
    // never in the catalog-only call (refine's convergence check stays as before)
    expect(diagnoseDeck(deck, cat).some((d) => d.id === ID)).toBe(false);
  });

  it("gone after augmenting; never on a template that already has 3 columns or cannot be augmented", async () => {
    const aug = await loadTemplate((await augmentAndVerify(bytes("技術報告_スタンダード水色_全レイアウト見本.pptx"))).bytes);
    for (const tpl of [aug, await loadTemplate(bytes("Midnight_Executive_30_TemplateOnly.pptx")), await loadTemplate(bytes("Dirty_AllBody_TemplateOnly.pptx"))]) {
      const cat = buildCatalog(tpl);
      expect(diagnoseDeck(parseMd(MD, cat), cat, tpl.layouts).some((d) => d.id === ID)).toBe(false);
    }
  });
});
