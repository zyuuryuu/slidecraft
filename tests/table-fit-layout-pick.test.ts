/**
 * table-fit-layout-pick.test.ts — #444: on the visual magazine master, a table slide's auto pick was
 * `02_ステートメント` (one body box 9.0"×0.9") — a 4-row table (header included) is estimated at ~1.13"
 * and always overflows it (#436's table-overflow warn). Root cause: 02_ステートメント and 08_目次
 * (12.13"×4.8") score EQUAL in pickLayout (both role content, 1 body, no "+addon", neither name matches
 * content|body|text) and the stable sort keeps file order, so 02 wins. The pick never looked at the table.
 *
 * Fix: pickLayout demotes a candidate whose box (the SAME ordinal box export places the table in) the
 * table is estimated to overflow — by the SAME judgment table-overflow uses (tableOverflow, R8). The
 * demotion is weaker than a body-count mismatch, and a table that overflows every candidate keeps the
 * old order (byte-identical).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { bodyPlaceholders } from "../src/engine/visual-placement";

const FIXTURES = resolve(__dirname, "fixtures/templates");
const MAGAZINE = resolve(FIXTURES, "ビジュアルデッキ_マガジン_全レイアウト見本.pptx");

/** A cover + one table slide of `n` rows INCLUDING the header row. */
function tableDeck(n: number): string {
  const body = Array.from({ length: n - 1 }, (_, i) => `| プラン${i} | ${(i + 1) * 1000} | 備考${i} |`).join("\n");
  return `# 表紙\n\n---\n\n# 料金表\n\n| プラン | 月額 | 備考 |\n|---|---|---|\n${body}\n`;
}

describe("#444 auto pick on the visual magazine master — a table avoids a box it overflows", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(MAGAZINE));
    catalog = buildCatalog(tpl);
  });
  const pick = (md: string) => {
    const deck = parseMd(md);
    return autoSelectLayout(deck.slides[1], 1, deck.slides.length, catalog);
  };

  it("4-row table → not 02_ステートメント (the 0.9in box) but 08_目次, and no table-overflow warn", () => {
    expect(pick(tableDeck(4))).toBe("08_目次");
    const issues = diagnoseDeck(parseMd(tableDeck(4)), catalog, tpl.layouts).filter((i) => i.id === "table-overflow");
    expect(issues).toEqual([]);
  });

  it("a 2-row table that fits the 0.9in box keeps the old pick (02_ステートメント)", () => {
    expect(pick(tableDeck(2))).toBe("02_ステートメント");
  });

  it("a table that overflows EVERY candidate keeps the old pick (order unchanged, warn still raised)", () => {
    expect(pick(tableDeck(47))).toBe("02_ステートメント");
    const issues = diagnoseDeck(parseMd(tableDeck(47)), catalog, tpl.layouts).filter((i) => i.id === "table-overflow");
    expect(issues).toHaveLength(1);
  });

  it("a table-less slide's pick is unchanged (02_ステートメント)", () => {
    expect(pick("# 表紙\n\n---\n\n# 要点\n\n- 一行の主張")).toBe("02_ステートメント");
  });
});

// R8 (b): the catalog's per-ordinal body boxes (what the pick reads) must equal the boxes export places
// a visual in (visual-placement.bodyPlaceholders → nthBody), for every layout of every fixture master.
describe("#444 agreement — CatalogEntry.bodyBoxes == bodyPlaceholders(layout) geometry", () => {
  const files = ["Midnight_Executive_30_TemplateOnly.pptx", "ビジュアルデッキ_マガジン_全レイアウト見本.pptx", "配布資料_公文書高密度_全レイアウト見本.pptx", "報告書テンプレート_公文書_白紺_全レイアウト見本.pptx", "lrk-slides-velis_CC0.pptx", "Dirty_Adversarial_TemplateOnly.pptx", "Dirty_AllBody_TemplateOnly.pptx", "Dirty_Grouped_TemplateOnly.pptx", "Dirty_Legacy43_TemplateOnly.pptx"];
  for (const f of files) {
    it(f, async () => {
      const t = await loadTemplate(readFileSync(resolve(FIXTURES, f)));
      const cat = buildCatalog(t);
      t.layouts.forEach((l, i) => {
        expect(cat[i].bodyBoxes, l.name).toEqual(bodyPlaceholders(l.placeholders).map((p) => ({ w: p.style.w, h: p.style.h })));
      });
    });
  }
});
