/**
 * section-missing-hint-662.test.ts — #662 `<!-- section -->` の章扉が、section 役のレイアウトを持たない
 * テンプレ（Pitch）で本文レイアウトに退化しても何も告げられない（never-silent 違反）。
 *
 * 修正: statement／quote 用の info `marker-layout-missing`（#593）を章扉にも出す。章扉かどうかは
 * deck-sections.ts、届いたかどうかは export と同じ autoSelectLayout の結果の role（template-catalog）で読む（R8）。
 *
 * 受け入れ基準（Issue 本文）: Pitch の章扉デッキで 1 件・文言に「章扉のレイアウトが無いので本文レイアウトに
 * 置いた」旨。section 役レイアウトを持つ技術報告・公文書・マガジン・Executive（＋統括指示の Campaign）では 0 件。
 * get_deck_issues は raw と materialized（章一覧つき章扉への固定後）の両方を見るので、両方で検査する。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { materializeDerivedSlides } from "../src/engine/deck-sections";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { parseMd } from "../src/engine/md-parser";

const SHIPPED_DIR = resolve(__dirname, "../public/templates/slide");
const PITCH = resolve(SHIPPED_DIR, "セールスピッチ_Pitch_TemplateOnly.pptx");
const REPRO = "# 表紙\n\n---\n\n<!-- section -->\n# 第1章\n\n---\n\n# 本文\n\n- a";

async function hits(path: string, md: string, materialize: boolean) {
  const tpl = await loadTemplate(readFileSync(path));
  const catalog = buildCatalog(tpl);
  const deck = materialize ? materializeDerivedSlides(parseMd(md), catalog) : parseMd(md);
  return diagnoseDeck(deck, catalog, tpl.layouts).filter((i) => i.id === "marker-layout-missing");
}

describe("#662 受け入れ基準: section 役レイアウトの無い Pitch で章扉の退化を info で告げる", () => {
  for (const materialize of [false, true]) {
    it(materialize ? "materialized" : "raw", async () => {
      const found = await hits(PITCH, REPRO, materialize);
      expect(found.map((h) => [h.slideIndex, h.level])).toEqual([[1, "info"]]);
      expect(found[0].message).toContain("章扉");
      expect(found[0].message).toContain("無い");
      expect(found[0].message).toContain("本文レイアウト「Content.1Body.Single」に置きました");
    });
  }

  it("GUI 経路（diagnoseDeck(deck, catalog)・layouts 無し）でも出る", async () => {
    const tpl = await loadTemplate(readFileSync(PITCH));
    const found = diagnoseDeck(parseMd(REPRO), buildCatalog(tpl)).filter((i) => i.id === "marker-layout-missing");
    expect(found.map((h) => h.slideIndex)).toEqual([1]);
  });

  it("章扉が 2 つなら 2 件（章扉ごとに 1 件）", async () => {
    const md = REPRO + "\n\n---\n\n<!-- section -->\n# 第2章";
    expect((await hits(PITCH, md, false)).map((h) => h.slideIndex)).toEqual([1, 3]);
  });

  it("テンプレにある pin を付けた章扉には出さない（pin はマーカーより優先する仕様）", async () => {
    const md = "# 表紙\n\n---\n\n<!-- slide: Content.1Body.Single -->\n<!-- section -->\n# 第1章";
    expect(await hits(PITCH, md, false)).toEqual([]);
  });

  it("テンプレ無し（catalog 無し）では出さない", () => {
    expect(diagnoseDeck(parseMd(REPRO)).filter((i) => i.id === "marker-layout-missing")).toEqual([]);
  });
});

describe("#662 不変条件: section 役レイアウトを持つテンプレでは 0 件", () => {
  for (const file of [
    "技術報告_スタンダード水色_TemplateOnly.pptx",
    "配布資料_公文書高密度_TemplateOnly.pptx",
    "ビジュアルデッキ_マガジン_TemplateOnly.pptx",
    "エグゼクティブ_Executive_TemplateOnly.pptx",
    "マーケ_Campaign_TemplateOnly.pptx",
  ]) {
    for (const materialize of [false, true]) {
      it(`${file}（${materialize ? "materialized" : "raw"}）`, async () => {
        expect(await hits(resolve(SHIPPED_DIR, file), REPRO, materialize)).toEqual([]);
      });
    }
  }
});

/**
 * 統括レビュー（PR #678）: section 役レイアウトを持つテンプレでも、章扉の解決先が section 役以外になる経路がある
 * （section 役は slideRoleRegions で hasTitle && !hasBody のときだけ・最終スライドの閉じ挨拶は closing 役）。
 * これは正しい解決であり「テンプレに無い」は偽なので告げない。告知はテンプレに section 役が無い場合に限る。
 */
describe("#662 不変条件: section 役を持つテンプレでは、本文つき章扉・閉じ挨拶の章扉でも 0 件（raw／materialized 一致）", () => {
  const cases: Array<[string, string]> = [
    ["<!-- section --> ＋ 本文 1 行", "# 表紙\n\n---\n\n<!-- section -->\n# 第1章\n\n本章の概要を述べる。\n\n---\n\n# 本文\n\n- a"],
    ["最終スライドが「ご清聴ありがとうございました」の章扉", "# 表紙\n\n---\n\n# 本文\n\n- a\n\n---\n\n<!-- section -->\n# ご清聴ありがとうございました"],
  ];
  for (const file of ["技術報告_スタンダード水色_TemplateOnly.pptx", "エグゼクティブ_Executive_TemplateOnly.pptx"]) {
    for (const [label, md] of cases) {
      it(`${file}: ${label}`, async () => {
        const raw = await hits(resolve(SHIPPED_DIR, file), md, false);
        const materialized = await hits(resolve(SHIPPED_DIR, file), md, true);
        expect(raw).toEqual([]);
        expect(materialized).toEqual([]);
        expect(raw.length).toBe(materialized.length);
      });
    }
  }
});
