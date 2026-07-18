/**
 * catalog-chrome-gate.test.ts — #127: catalog の bodyCount / bodyBoxes に chrome ゲートを適用する。
 *
 * #124 は binding 側の body 序数（bodyPlaceholders）から chrome 帯を除外したが、catalog 側の
 * bodyCount は role のみで数え続けていた。両者が食い違い、レイアウト選択は「本文枠が 1 つある」と
 * 信じて chrome 帯しか持たないレイアウトを content に選びうる。
 *
 * 実例: 配布資料_公文書高密度 の 05_比較表（唯一の body が 資料名スロット idx=31 type="body" 3.10×0.62
 * @y=0.28 fs=9・scorer=chrome）。catalog bodyCount=1 だが bodyPlaceholders()=[]。結果 content-1body /
 * content-table / diagram スライドが 05_比較表 に誘導され、テキストの行き場が無かった。
 * 健全な双子 技術報告_スタンダード水色 の 05_比較表 は最初から bodyCount=0 role=section＝
 * 「同じ形のレイアウトが 2 つの異なる姿に見えている」を本修正で一致させる。
 *
 * 不変条件:
 *  - **全同梱テンプレの全レイアウトで catalog.bodyCount === bodyPlaceholders(l.placeholders).length**（核）。
 *  - chrome ∧ role=body を持たない健全テンプレでは完全な no-op（body は 1 件も減らない＝byte-identical）。
 *  - chrome の判定は1本（bodyPlaceholders と同じ isContentBody を共有）——2 箇所に複製しない（#96 の教訓）。
 *  - blast radius: 05_比較表 が content→section に動くので、レイアウト割り当てが動くスライドを golden で明示。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, placeholderRole, type LayoutCatalog } from "../src/engine/template-catalog";
import { bodyPlaceholders } from "../src/engine/visual-placement";
import type { SlideIR } from "../src/engine/slide-schema";

const pub = (p: string) => resolve(__dirname, "../public/templates/slide", p);
// The 4 bundled (git-tracked) masters. The invariant is fixed across ALL of them.
const BUNDLED = [
  "Midnight_Executive_30_TemplateOnly.pptx",
  "技術報告_スタンダード水色_TemplateOnly.pptx",
  "ビジュアルデッキ_マガジン_TemplateOnly.pptx",
  "配布資料_公文書高密度_TemplateOnly.pptx",
];
// Masters that carry NO chrome∧role=body placeholder ⇒ the gate is a no-op ⇒ byte-identical.
const HEALTHY = ["Midnight_Executive_30_TemplateOnly.pptx", "技術報告_スタンダード水色_TemplateOnly.pptx"];

const load = async (name: string): Promise<{ tpl: TemplateData; catalog: LayoutCatalog }> => {
  const tpl = await loadTemplate(readFileSync(pub(name)));
  return { tpl, catalog: buildCatalog(tpl) };
};

// ── 核: catalog の bodyCount と binding の body 序数が全レイアウトで一致する ──
describe("#127 catalog.bodyCount === bodyPlaceholders().length（全同梱テンプレの全レイアウト）", () => {
  for (const name of BUNDLED) {
    it(`${name}: 全レイアウトで一致`, async () => {
      const { tpl, catalog } = await load(name);
      for (const l of tpl.layouts) {
        const e = catalog.find((c) => c.name === l.name)!;
        expect(e, `catalog に ${l.name} が必要`).toBeDefined();
        // catalog の「本文枠は N 個」と、実際に visual/text が入れる body 序数の個数が一致すること。
        expect(e.bodyCount, `${name} / ${l.name}`).toBe(bodyPlaceholders(l.placeholders).length);
      }
    });
  }
});

// ── 健全テンプレは byte-identical（gate は no-op） ──
describe("#127 健全テンプレでは chrome ゲートが no-op（body は 1 件も減らない）", () => {
  for (const name of HEALTHY) {
    it(`${name}: chrome ∧ role=body の placeholder は 0 件＝bodyCount は素の role カウントと一致`, async () => {
      const { tpl, catalog } = await load(name);
      for (const l of tpl.layouts) {
        for (const ph of l.placeholders) {
          if (placeholderRole(ph) === "body") {
            expect(ph.inferredFunction, `${name}/${l.name}/idx${ph.idx} は chrome であってはならない`).not.toBe("chrome");
          }
        }
        // ゲート前後で bodyCount が変わらない証拠: chrome 除外なしの素の role カウントと一致。
        const naive = l.placeholders.filter((p) => placeholderRole(p) === "body").length;
        expect(catalog.find((c) => c.name === l.name)!.bodyCount, `${name}/${l.name}`).toBe(naive);
      }
    });
  }
});

// ── 05_比較表: 2 つの姿を一致させる ──
describe("#127 配布資料_公文書高密度 05_比較表 は 技術報告 版と同じ姿になる", () => {
  let koubun: LayoutCatalog;
  let gihou: LayoutCatalog;
  beforeAll(async () => {
    koubun = (await load("配布資料_公文書高密度_TemplateOnly.pptx")).catalog;
    gihou = (await load("技術報告_スタンダード水色_TemplateOnly.pptx")).catalog;
  });

  it("公文書 05_比較表: bodyCount 0・role section（chrome 帯だけ＝実 body ゼロ）", () => {
    const e = koubun.find((c) => c.name === "05_比較表")!;
    expect(e.bodyCount).toBe(0);
    expect(e.role).toBe("section");
  });

  it("技術報告 05_比較表 と bodyCount / role が一致（同じ形が同じ姿に）", () => {
    const k = koubun.find((c) => c.name === "05_比較表")!;
    const g = gihou.find((c) => c.name === "05_比較表")!;
    expect({ bodyCount: k.bodyCount, role: k.role }).toEqual({ bodyCount: g.bodyCount, role: g.role });
  });

  it("資料名スロット(31) は role=body のまま catalog placeholders に残る（bijection 不変・bodyCount からのみ除外）", () => {
    const e = koubun.find((c) => c.name === "05_比較表")!;
    // 帯は編集可能なフィールドとして placeholders に残す（buildFieldMap の 1:1 を壊さない）。
    // 除外されるのは bodyCount / body 序数のみ。
    expect(e.placeholders.some((p) => p.idx === "31" && p.role === "body")).toBe(true);
  });
});

// ── blast radius golden: レイアウト割り当てが動くスライドを明示 ──
describe("#127 レイアウト割り当て golden（配布資料_公文書高密度）", () => {
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    catalog = (await load("配布資料_公文書高密度_TemplateOnly.pptx")).catalog;
  });
  const ph = (idx: string, text = "x") => ({ idx, paragraphs: [{ segments: [{ text }] }] });
  const mk = (o: Partial<SlideIR>): SlideIR => ({ layout: "auto", placeholders: [], ...o }) as SlideIR;

  // 修正前 → 修正後。content 家族の 3 スライドだけが 05_比較表 を離れ、実 body を持つ 08_目次 へ移る。
  // 他の役割（cover/section/columns/closing）は不変＝blast radius は content 家族に限定される。
  const CASES: Array<[string, SlideIR, number, string, string]> = [
    ["cover(first)", mk({ placeholders: [ph("15", "T"), ph("16", "sub")] }), 0, "00_表紙", "00_表紙"],
    ["section", mk({ placeholders: [ph("15", "章")] }), 1, "01_章扉", "01_章扉"],
    ["content-1body", mk({ placeholders: [ph("15", "T"), ph("1", "body")] }), 2, "05_比較表", "08_目次"],
    ["content-table", mk({ placeholders: [ph("15", "T")], table: { rows: [["a", "b"]], header: true, placeholderIdx: "1" } }), 3, "05_比較表", "08_目次"],
    ["2col", mk({ placeholders: [ph("15"), ph("1"), ph("2")] }), 4, "04_図＋説明", "04_図＋説明"],
    ["3col", mk({ placeholders: [ph("15"), ph("1"), ph("2"), ph("3")] }), 5, "04_図＋説明", "04_図＋説明"],
    ["diagram", mk({ placeholders: [ph("15", "T")], diagram: { yaml: "type: flowchart", placeholderIdx: "1" } as SlideIR["diagram"] }), 6, "05_比較表", "08_目次"],
    ["closing", mk({ placeholders: [ph("15", "まとめ")] }), 7, "06_まとめ", "06_まとめ"],
  ];

  it.each(CASES)("%s → %s（修正後）", (_label, slide, i, _before, after) => {
    expect(autoSelectLayout(slide, i, 8, catalog)).toBe(after);
  });

  it("content スライドは chrome 帯だけの 05_比較表 に二度と誘導されない", () => {
    for (const [, slide, i] of CASES) {
      expect(autoSelectLayout(slide, i, 8, catalog)).not.toBe("05_比較表");
    }
  });
});
