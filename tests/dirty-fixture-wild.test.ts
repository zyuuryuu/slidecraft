/**
 * dirty-fixture-wild.test.ts — 「実社会の汚れ」第2弾 fixture 群（scripts/make-dirty-fixture-2.ts 産）。
 *
 * 共通ポリシー: fixture は **OOXML として valid・PowerPoint で開けば視覚的にキレイ**。
 * 汚れは type/idx/属性の使い方（＝ツールが読む慣習）だけに仕込む。壊れたファイル・
 * 幾何エラー（w/h=0 等）・視覚破綻は仕込まない。
 *
 * Dirty_Adversarial（生テキスト見出し・命名ゴミ）が扱わない dirt ファミリを固定する:
 *   Dirty_AllBody    … 全 placeholder が type="body"（見出しも副題もフッタも）。見た目は完全に普通
 *   Dirty_Legacy43   … 4:3・幾何は master 継承だのみ・typeless/巨大 idx（幾何自体は健全）・ftr/dt/sldNum 常駐
 *   Dirty_Grouped    … タイトル生テキストがスケール付き p:grpSp の中（PowerPoint は正しく描く）
 *
 * 検証方針は master-pathology.test.ts と同じ: (a) 仕込んだ病理が実 pptx 経由で検出される、
 * (b) 「仕込んでいない」病理は出ない（fixture の汚れが意図した1点に絞れている証明）、
 * (c) 汚れていても loadTemplate / buildCatalog が生存し、テンプレとして使用可能（床）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, assessTemplateHealth } from "../src/engine/template-catalog";
import { detectPathologies } from "../src/engine/master-pathology";

const fx = (p: string) => resolve(__dirname, "fixtures/templates", p);
const load = async (name: string) => loadTemplate(readFileSync(fx(name)));

describe("Dirty_AllBody — 全 placeholder が body 型（見た目は完全に普通）", () => {
  it("loadTemplate が生存し、テンプレとして rejected にならない", async () => {
    const tpl = await load("Dirty_AllBody_TemplateOnly.pptx");
    expect(tpl.layouts.length).toBeGreaterThanOrEqual(4);
    const health = assessTemplateHealth(buildCatalog(tpl));
    expect(health.status).not.toBe("rejected");
  });

  it("title=body 型の病理を検出する（型が全部嘘をついている）", async () => {
    const tpl = await load("Dirty_AllBody_TemplateOnly.pptx");
    const r = detectPathologies(tpl, "Dirty_AllBody");
    expect(r.counts["title-as-body"] ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("仕込んでいない病理は出ない（汚れは typing だけ・幾何/寸法/typeless はクリーン）", async () => {
    const tpl = await load("Dirty_AllBody_TemplateOnly.pptx");
    const r = detectPathologies(tpl, "Dirty_AllBody");
    expect(r.counts["unresolved-geometry"] ?? 0).toBe(0);
    expect(r.counts["typeless-placeholder"] ?? 0).toBe(0);
    expect(r.counts["non-standard-slide-size"] ?? 0).toBe(0);
  });
});

describe("Dirty_Legacy43 — 4:3・master 継承だのみ・typeless/巨大 idx", () => {
  it("loadTemplate が生存し、テンプレとして rejected にならない", async () => {
    const tpl = await load("Dirty_Legacy43_TemplateOnly.pptx");
    expect(tpl.layouts.length).toBeGreaterThanOrEqual(3);
    const health = assessTemplateHealth(buildCatalog(tpl));
    expect(health.status).not.toBe("rejected");
  });

  it("非16:9（10×7.5・valid な 4:3）を検出する", async () => {
    const tpl = await load("Dirty_Legacy43_TemplateOnly.pptx");
    const r = detectPathologies(tpl, "Dirty_Legacy43");
    expect(r.slideSize.w).toBeCloseTo(10, 1);
    expect(r.slideSize.h).toBeCloseTo(7.5, 1);
    expect(r.counts["non-standard-slide-size"] ?? 0).toBe(1);
  });

  it("非慣習 idx の typeless placeholder（巨大 idx・idx=13、幾何は自前で健全）を検出する", async () => {
    const tpl = await load("Dirty_Legacy43_TemplateOnly.pptx");
    const r = detectPathologies(tpl, "Dirty_Legacy43");
    expect(r.counts["typeless-placeholder"] ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("幾何未解決は出ない（xfrm 省略は全て master 継承で解決する＝valid な作り）", async () => {
    const tpl = await load("Dirty_Legacy43_TemplateOnly.pptx");
    const r = detectPathologies(tpl, "Dirty_Legacy43");
    expect(r.counts["unresolved-geometry"] ?? 0).toBe(0);
  });

  it("xfrm 継承が生きている: 本文レイアウトの body(idx=1・xfrm 無し)が master 幾何を得る", async () => {
    const tpl = await load("Dirty_Legacy43_TemplateOnly.pptx");
    const content = tpl.layouts.find((l) => l.name.includes("コンテンツ"))!;
    const body = content.placeholders.find((p) => p.type === "body" && p.idx === "1")!;
    expect(body.style.w).toBeGreaterThan(0);
    expect(body.style.h).toBeGreaterThan(0);
  });

  it("ftr/dt/sldNum の chrome トリオ（実機の idx=2/3/4 慣習）が本文枠として数えられない", async () => {
    const tpl = await load("Dirty_Legacy43_TemplateOnly.pptx");
    const catalog = buildCatalog(tpl);
    const content = catalog.find((e) => e.name.includes("コンテンツ"))!;
    expect(content.bodyCount).toBeLessThanOrEqual(2);
  });
});

describe("Dirty_Grouped — スケール付きグループ内のタイトル生テキスト", () => {
  it("loadTemplate がネストした p:grpSp でも生存する", async () => {
    const tpl = await load("Dirty_Grouped_TemplateOnly.pptx");
    expect(tpl.layouts.length).toBeGreaterThanOrEqual(2);
    const health = assessTemplateHealth(buildCatalog(tpl));
    expect(health.status).not.toBe("rejected");
  });

  it("グループ内の生テキスト見出しも staticText として（テキストは）拾われる", async () => {
    const tpl = await load("Dirty_Grouped_TemplateOnly.pptx");
    const cover = tpl.layouts.find((l) => l.name.includes("表紙"))!;
    const texts = cover.staticTexts.map((s) => s.text);
    expect(texts.some((t) => t.includes("年次報告 2026"))).toBe(true);
  });

  // 既知ギャップの計測固定: extractStaticTexts はグループ変換（chOff/chExt スケール）を合成しない
  // ため、グループ内テキストの幾何は「子座標系のまま」になる。PowerPoint はこのファイルを正しく
  // （スライド座標 y=1.5/w=6 で）描くので、見た目はキレイだがツールだけが誤読する、という dirt。
  // 合成が実装されたらこのアサーションをスライド座標側（w≈6, y≈1.5）へ反転させること。
  it("GAP: グループ内 staticText の幾何は未合成（子座標のまま）", async () => {
    const tpl = await load("Dirty_Grouped_TemplateOnly.pptx");
    const cover = tpl.layouts.find((l) => l.name.includes("表紙"))!;
    const title = cover.staticTexts.find((s) => s.text.includes("年次報告 2026"))!;
    expect(title.style.w).toBeCloseTo(3, 1); // 子座標（スライド座標なら 6）
    expect(title.style.y).toBeCloseTo(0.25, 1); // 子座標（スライド座標なら 1.5）
  });
});
