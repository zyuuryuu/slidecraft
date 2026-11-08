/**
 * common-structures-593.test.ts — #593（#580 段 2-a・共通構造 I）のうち、SlideIR を変えずに入る部分。
 *
 *  (c) ヒーロー数値: `<!-- kpi -->` 1 つ → KPI.1Value.Single で「値が大数字枠・見出しがラベル枠」。
 *      原因は group-layout の枠タグ付けが「いちばん上の枠＝見出し」と決め打ちしていたこと。canonical の
 *      KPI.*Value は大数字枠がラベル枠の上にあるので、見出しが大数字枠に入っていた（Midnight で実測）。
 *  (d) CTA 締め: CLOSING_RE に 次のステップ・お問い合わせ・ご相談 を足す＋ Closing.1CTA+1Contact（新）。
 *  (e) 名前ベース到達（kpi）: マガジンの `05_ビッグナンバー` を kpi 1 枠として認識し、kpi 1 つのスライド
 *      だけがそこへ届く。
 *  新 LayoutDef（Statement.1Message.Single・Quote.1Message.Single+1Attribution・Closing.1CTA+1Contact）は
 *  生成テンプレに入るが、マーカー無しのスライドの選択は 1 枚も変えない。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, classifyLayout, layoutRole, CLOSING_RE, type LayoutCatalog } from "../src/engine/template-catalog";
import { expandGroups } from "../src/engine/group-binding";
import { bindContentByRole } from "../src/engine/placeholder-binding";
import { writeTemplate, MIDNIGHT_PALETTE, type TemplateSpec } from "../src/engine/template-writer";
import { BUILTIN_LAYOUTS } from "../src/engine/template-layout-library";
import { LAYOUT_NAMES, type SlideIR, type PlaceholderContent } from "../src/engine/slide-schema";
import { parseMd } from "../src/engine/md-parser";

const MIDNIGHT = resolve(__dirname, "../samples/templates/Midnight_Executive_30_TemplateOnly.pptx");
const MAGAZINE = resolve(__dirname, "../public/templates/slide/ビジュアルデッキ_マガジン_TemplateOnly.pptx");
const MAGAZINE_FIXTURE = resolve(__dirname, "fixtures/templates/ビジュアルデッキ_マガジン_全レイアウト見本.pptx");

const NEW_LAYOUTS = ["Statement.1Message.Single", "Quote.1Message.Single+1Attribution", "Closing.1CTA+1Contact"] as const;
const spec = (layouts?: TemplateSpec["layouts"]): TemplateSpec => ({
  name: "Generated",
  fonts: { major: "Georgia", minor: "Calibri" },
  palette: { ...MIDNIGHT_PALETTE },
  ...(layouts ? { layouts } : {}),
});

const COVER = "# 表紙\n\nサブタイトル\n\n---\n\n";
const KPI1 = COVER + "# 1 件の検索が 15 分 → 2 分に\n\n<!-- kpi -->\n### 検索時間\n- **2 分**\n- 1 件あたり平均（現状 15 分）";
const KPI3 =
  COVER + "# 期待効果\n\n<!-- kpi -->\n### 検索時間\n- 2 分\n- 現状 15 分\n\n<!-- kpi -->\n### 問い合わせ\n- 40% 減\n\n<!-- kpi -->\n### 立ち上がり\n- 2 週";

const text = (c: PlaceholderContent | undefined) => c?.paragraphs.map((p) => p.segments.map((s) => s.text).join("")).join("\n");
const lastSlide = (md: string) => {
  const deck = parseMd(md);
  return { slide: deck.slides[deck.slides.length - 1], n: deck.slides.length };
};
const pickLast = (md: string, catalog: LayoutCatalog) => {
  const { slide, n } = lastSlide(md);
  return autoSelectLayout(slide, n - 1, n, catalog);
};
const layoutOf = (tpl: TemplateData, name: string) => tpl.layouts.find((l) => l.name === name)!;
/** Content bound to the layout placeholder named `phName` (grouped slide → expandGroups). */
const boundByName = (slide: SlideIR, tpl: TemplateData, layoutName: string) => {
  const layout = layoutOf(tpl, layoutName);
  const bound = slide.groupKind ? expandGroups(slide, layout) : bindContentByRole(slide, layout.placeholders);
  return (phName: string) => text(bound.get(layout.placeholders.find((p) => p.name === phName)!.idx));
};

// ── (c) ヒーロー数値：KPI.1Value.Single の束縛 ──

describe("#593 (c) kpi 1 つ → KPI.1Value.Single で値が大数字枠・見出しがラベル枠", () => {
  for (const [label, load] of [
    ["Midnight（samples）", async () => loadTemplate(readFileSync(MIDNIGHT))],
    ["生成テンプレ（writer 既定）", async () => loadTemplate(await writeTemplate(spec()))],
  ] as const) {
    it(label, async () => {
      const tpl = await load();
      const catalog = buildCatalog(tpl);
      expect(pickLast(KPI1, catalog)).toBe("KPI.1Value.Single");
      const at = boundByName(lastSlide(KPI1).slide, tpl, "KPI.1Value.Single");
      expect(at("Value.Center")).toBe("2 分");
      expect(at("ValueLabel.Center")).toBe("検索時間");
      expect(at("ValueDesc.Center")).toBe("1 件あたり平均（現状 15 分）");
      expect(at("SlideTitle.Header")).toBe("1 件の検索が 15 分 → 2 分に");
    });
  }

  it("見出しの無い kpi（値だけ）も大数字枠に入る", async () => {
    const tpl = await loadTemplate(readFileSync(MIDNIGHT));
    const { slide } = lastSlide(COVER + "# 効果\n\n<!-- kpi -->\n- 2 分");
    expect(boundByName(slide, tpl, "KPI.1Value.Single")("Value.Center")).toBe("2 分");
  });

  it("同じ逆転を持つ KPI.3Value.Equal（大数字枠が上・ラベル枠が下の 2 枠）: 値→大数字枠、見出し＋補足→ラベル枠", async () => {
    const tpl = await loadTemplate(readFileSync(MIDNIGHT));
    expect(pickLast(KPI3, buildCatalog(tpl))).toBe("KPI.3Value.Equal");
    const at = boundByName(lastSlide(KPI3).slide, tpl, "KPI.3Value.Equal");
    expect(at("Value1")).toBe("2 分");
    expect(at("Label1")).toBe("検索時間\n現状 15 分");
    expect(at("Value3")).toBe("2 週");
    expect(at("Label3")).toBe("立ち上がり");
  });

  it("回帰: ラベル枠が上・数値枠が下のテンプレ（マガジン 09_KPIハイライト）は従来どおり", async () => {
    const tpl = await loadTemplate(readFileSync(MAGAZINE));
    expect(pickLast(KPI3, buildCatalog(tpl))).toBe("09_KPIハイライト");
    const at = boundByName(lastSlide(KPI3).slide, tpl, "09_KPIハイライト");
    expect(at("KPIラベル1")).toBe("検索時間");
    expect(at("KPI数値1")).toBe("2 分");
    expect(at("KPI補足1")).toBe("現状 15 分");
    expect(at("KPIラベル3")).toBe("立ち上がり");
    expect(at("KPI数値3")).toBe("2 週");
  });
});

// ── (e) 名前ベース到達：マガジン 05_ビッグナンバー（kpi マーカー付きのみ）──

for (const [label, file] of [["出荷", MAGAZINE], ["全レイアウト見本 fixture", MAGAZINE_FIXTURE]] as const) {
  describe(`#593 (e) マガジン（${label}）: kpi 1 つは 05_ビッグナンバー へ`, () => {
    let tpl: TemplateData;
    let catalog: LayoutCatalog;
    beforeAll(async () => {
      tpl = await loadTemplate(readFileSync(file));
      catalog = buildCatalog(tpl);
    });

    it("kpi 1 つ → 05_ビッグナンバー。値が大数字枠・見出しが注記枠・残りが補足枠・タイトルはタイトル枠", () => {
      expect(pickLast(KPI1, catalog)).toBe("05_ビッグナンバー");
      const at = boundByName(lastSlide(KPI1).slide, tpl, "05_ビッグナンバー");
      expect(at("ビッグナンバー")).toBe("2 分");
      expect(at("注記")).toBe("検索時間");
      expect(at("補足")).toBe("1 件あたり平均（現状 15 分）");
      expect(at("Title 1")).toBe("1 件の検索が 15 分 → 2 分に");
    });

    it("kpi 2〜3 は従来どおり 09_KPIハイライト", () => {
      expect(pickLast(KPI3, catalog)).toBe("09_KPIハイライト");
      expect(pickLast(COVER + "# 効果\n\n<!-- kpi -->\n### A\n- 1\n\n<!-- kpi -->\n### B\n- 2", catalog)).toBe("09_KPIハイライト");
    });

    it("マーカー無しのスライドは 05_ビッグナンバー に届かない（本文・段落・2 カラム）", () => {
      for (const body of ["# 要点\n\n- 2 分", "# 要点\n\n本文の段落です。", "# 比較\n\n<!-- col -->\n- 左\n\n<!-- col -->\n- 右"]) {
        expect(pickLast(COVER + body, catalog)).not.toBe("05_ビッグナンバー");
      }
    });
  });
}

// ── (d) CTA 締め ──

describe("#593 (d) CLOSING_RE: 日本語の CTA 締め語彙", () => {
  it.each(["次のステップ", "今後のステップ", "お問い合わせ", "ご相談はこちら"])("%s → closing", (t) => {
    expect(CLOSING_RE.test(t)).toBe(true);
  });
  it.each(["ステップ 1：要件定義", "相談窓口の設計", "問い合わせ件数の推移"])("%s は closing ではない", (t) => {
    expect(CLOSING_RE.test(t)).toBe(false);
  });
});

describe("#593 (d) 「次のステップ」タイトルの最終スライドは Closing 系に", () => {
  const NEXT = COVER + "# 次のステップ\n\n- 2 週間のパイロットを始める";
  it("Midnight → Closing.1Steps.Single+1Notes（本文あり）／タイトルだけなら Closing.1Message.Single", async () => {
    const catalog = buildCatalog(await loadTemplate(readFileSync(MIDNIGHT)));
    expect(pickLast(NEXT, catalog)).toBe("Closing.1Steps.Single+1Notes");
    expect(pickLast(COVER + "# お問い合わせ", catalog)).toBe("Closing.1Message.Single");
  });
  it("マガジン → 06_まとめ", async () => {
    expect(pickLast(NEXT, buildCatalog(await loadTemplate(readFileSync(MAGAZINE))))).toBe("06_まとめ");
  });
  it("最終スライドでなければ締めにしない（途中の「次のステップ」は本文）", async () => {
    const catalog = buildCatalog(await loadTemplate(readFileSync(MIDNIGHT)));
    const deck = parseMd(NEXT + "\n\n---\n\n# 付録\n\n- 補足");
    expect(autoSelectLayout(deck.slides[1], 1, deck.slides.length, catalog)).toBe("Content.1Body.Single");
  });
  it("締めの候補が Closing.1CTA+1Contact だけのテンプレでは、それが選ばれ本文は CTA 枠に入る", async () => {
    const subset = BUILTIN_LAYOUTS.filter((d) => !d.name.startsWith("Closing.") || d.name === "Closing.1CTA+1Contact");
    const tpl = await loadTemplate(await writeTemplate(spec(subset)));
    expect(pickLast(NEXT, buildCatalog(tpl))).toBe("Closing.1CTA+1Contact");
    const at = boundByName(lastSlide(NEXT).slide, tpl, "Closing.1CTA+1Contact");
    expect(at("CTA.Center")).toBe("2 週間のパイロットを始める");
    expect(at("SlideTitle.Header")).toBe("次のステップ");
  });
});

// ── 新 LayoutDef ──

describe("#593 新 LayoutDef（語彙・役割・生成テンプレ）", () => {
  it("LAYOUT_NAMES と BUILTIN_LAYOUTS に入っている", () => {
    for (const name of NEW_LAYOUTS) {
      expect(LAYOUT_NAMES).toContain(name);
      expect(BUILTIN_LAYOUTS.map((d) => d.name)).toContain(name);
    }
  });
  it("名前の family から役割が決まる（Statement→statement・Quote→quote・Closing→closing）", () => {
    expect(layoutRole("Statement.1Message.Single")).toBe("statement");
    expect(layoutRole("Quote.1Message.Single+1Attribution")).toBe("quote");
    expect(layoutRole("Closing.1CTA+1Contact")).toBe("closing");
  });
  it("Statement は主枠（タイトル）が本文より大きい／Quote は引用枠が帰属枠より大きい", () => {
    const def = (n: string) => BUILTIN_LAYOUTS.find((d) => d.name === n)!;
    const fs = (n: string, ph: string) => def(n).placeholders.find((p) => p.name === ph)!.fontSize;
    expect(fs("Statement.1Message.Single", "Message.Center")).toBeGreaterThan(fs("Statement.1Message.Single", "Supporting.Bottom"));
    expect(fs("Quote.1Message.Single+1Attribution", "Quote.Center")).toBeGreaterThan(fs("Quote.1Message.Single+1Attribution", "Attribution.Bottom"));
    expect(fs("Closing.1CTA+1Contact", "CTA.Center")).toBeGreaterThan(fs("Closing.1CTA+1Contact", "Contact.Bottom"));
  });
  it("生成テンプレ: マーカー無しスライドの選択は、新レイアウトを除いた生成テンプレと 1 枚も変わらない", async () => {
    const withNew = buildCatalog(await loadTemplate(await writeTemplate(spec())));
    const legacy = buildCatalog(
      await loadTemplate(await writeTemplate(spec(BUILTIN_LAYOUTS.filter((d) => !(NEW_LAYOUTS as readonly string[]).includes(d.name))))),
    );
    const SLIDES = [
      "# 要点\n\n- 一行の主張",
      "# 要点\n\n本文の段落です。",
      "# 比較\n\n<!-- col -->\n- 左\n\n<!-- col -->\n- 右",
      "<!-- section -->\n# 第1章",
      "# 必要な情報に、15 分かけていませんか。",
      "# お客様の声\n\n「過去提案が 1 回の質問で出てくる。」\n\n— パイロット部門 マネージャー",
      "# まとめ\n\n- 結論",
      "# まとめ",
      "# 効果\n\n<!-- kpi -->\n### 検索時間\n- 2 分",
    ];
    for (const body of SLIDES) expect(pickLast(COVER + body, withNew)).toBe(pickLast(COVER + body, legacy));
  });
});

// ── classifyLayout：名前からの役割推定（引用）──

describe("#593 classifyLayout: 引用／quote は quote 系（content ではない）", () => {
  const twoBody = { hasTitle: true, hasSubtitle: false, bodyCount: 2 };
  it.each(["07_引用", "Quote", "Customer Quote", "お客様の声"])("%s → quote", (name) => {
    expect(classifyLayout(name, twoBody)).toBe("quote");
  });
  it("マガジンの 07_引用 は quote・マーカー無しの本文／2 カラムには選ばれない", async () => {
    const catalog = buildCatalog(await loadTemplate(readFileSync(MAGAZINE)));
    expect(catalog.find((e) => e.name === "07_引用")?.role).toBe("quote");
    expect(pickLast(COVER + "# お客様の声\n\n「過去提案が 1 回の質問で出てくる。」\n\n— マネージャー", catalog)).toBe("13_本文（1カラム）");
    expect(pickLast(COVER + "# 比較\n\n<!-- col -->\n- 左\n\n<!-- col -->\n- 右", catalog)).toBe("03_本文（2カラム）");
  });
});
