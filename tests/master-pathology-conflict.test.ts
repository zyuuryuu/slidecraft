/**
 * master-pathology-conflict.test.ts — #146 シグナル矛盾センサス（type/idx vs 幾何）。
 *
 * 層1（ロール推論）は first-match-wins の梯子で、type が答えると幾何の異議は記録されずに捨てられる。
 * 梯子→証拠融合への転換は大きな設計判断なので、先に矛盾の実頻度を測る（ADR-0030 Consequences）。
 * このテストは計測の較正を固定する:
 *   (a) Dirty_AllBody（全 placeholder が body 型・見出しも body）で矛盾 ≥4（全レイアウト）、
 *   (b) クリーンな同梱 4 マスターで矛盾 0（過検出しない）、
 *   (c) 挙動変更ゼロ＝既存 counts/findings は 1 件も変わらない（追加フィールドのみ）、
 *   (d) 合成スタブで判定式（クラス比較＋決定的幾何ゲート）を精密検証。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";
import { detectPathologies } from "../src/engine/master-pathology";
import type { PlaceholderInfo } from "../src/engine/template-loader";

const fx = (p: string) => resolve(__dirname, "fixtures/templates", p);
const pub = (p: string) => resolve(__dirname, "../public/templates/slide", p);

describe("シグナル矛盾 — Dirty_AllBody（type が全部嘘のテンプレ）", () => {
  it("全 4 レイアウトの body 型見出しが矛盾として検出される（≥4）", async () => {
    const tpl = await loadTemplate(readFileSync(fx("Dirty_AllBody_TemplateOnly.pptx")));
    const r = detectPathologies(tpl, "AllBody");
    expect(r.conflicts.length).toBeGreaterThanOrEqual(4);
    // fixture の具体事実で固定する（レビュー指摘: 判定式から従属導出できる恒真 assert は書かない）。
    // 「type=body vs 幾何=見出し帯」が全 4 レイアウトに 1 件ずつ（40pt 中央見出し等）。
    const key = (c: { layout: string; idx: string; typeRole: string; geoRole: string; fs: number }) =>
      `${c.layout}/${c.typeRole}@${c.idx}→${c.geoRole} fs${c.fs}`;
    expect(r.conflicts.map(key).sort()).toEqual([
      "2 つのコンテンツ/body@10→title fs24",
      "クロージング/body@1→subtitle fs32",
      "タイトル スライド/body@1→subtitle fs40",
      "タイトルとコンテンツ/body@10→title fs24",
    ]);
  });

  it("挙動変更ゼロ: 既存 counts/findings は矛盾計数の追加で 1 件も変わらない", async () => {
    const tpl = await loadTemplate(readFileSync(fx("Dirty_AllBody_TemplateOnly.pptx")));
    const r = detectPathologies(tpl, "AllBody");
    // 実装前ベースライン（2026-07-19 計測）: title-as-body×4 のみ・total 4
    expect(r.counts).toEqual({ "title-as-body": 4 });
    expect(r.total).toBe(4);
    expect(r.findings).toHaveLength(4);
    expect(r.findings.every((f) => f.kind === "title-as-body")).toBe(true);
  });
});

describe("シグナル矛盾 — クリーンな同梱マスターで過検出しない", () => {
  for (const name of [
    "Midnight_Executive_30_TemplateOnly.pptx",
    "技術報告_スタンダード水色_TemplateOnly.pptx",
    "配布資料_公文書高密度_TemplateOnly.pptx",
    "ビジュアルデッキ_マガジン_TemplateOnly.pptx",
  ]) {
    it(`${name}: 矛盾 0`, async () => {
      const tpl = await loadTemplate(readFileSync(pub(name)));
      const r = detectPathologies(tpl, name);
      expect(r.conflicts).toEqual([]);
    });
  }
});

describe("シグナル矛盾 — 実サードパーティ（committed fixture）で実在を観測", () => {
  it("velis (CC0): body 型の大フォント見出し矛盾が ≥1 件ある", async () => {
    const tpl = await loadTemplate(readFileSync(fx("lrk-slides-velis_CC0.pptx")));
    const r = detectPathologies(tpl, "velis");
    expect(r.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(r.conflicts.some((c) => c.typeRole === "body" && c.geoRole === "title")).toBe(true);
  });
});

// ── 合成スタブ（判定式の精密検証）── 既存 master-pathology.test.ts と同じスタブ規約
const mkPh = (type: string, idx: string, x: number, y: number, w: number, h: number, fs: number): PlaceholderInfo =>
  ({ idx, type, name: `n${idx}`, shapeXml: "", style: { x, y, w, h, fontSize: fs, fontColor: "000000", fontName: "", bold: false, align: "l", bulletChar: "" }, metaIdxConvention: false }) as unknown as PlaceholderInfo;
const mkLayout = (name: string, phs: PlaceholderInfo[]) =>
  ({ index: 1, name, placeholders: phs, decorations: [], images: [], staticTexts: [] });
const stub = (layouts: ReturnType<typeof mkLayout>[], sldSz = '<p:sldSz cx="12192000" cy="6858000"/>') =>
  ({ layouts, presentationXml: sldSz } as never);

describe("シグナル矛盾 — 合成スタブ（判定式）", () => {
  it("body 型×幾何 title 帯×最大フォント 18pt+ → 矛盾（相対値付きで列挙）", () => {
    const r = detectPathologies(
      stub([mkLayout("L", [mkPh("body", "10", 0.6, 0.35, 12.1, 0.8, 28), mkPh("body", "1", 0.6, 1.6, 12.1, 5, 14)])]),
      "s",
    );
    expect(r.conflicts).toHaveLength(1);
    const c = r.conflicts[0];
    expect(c).toMatchObject({ layout: "L", idx: "10", type: "body", typeRole: "body", geoRole: "title", fs: 28 });
    expect(c.yRel).toBeCloseTo(0.35 / 7.5, 5);
    expect(c.hRel).toBeCloseTo(0.8 / 7.5, 5);
  });

  it("メタ帯同士のサブ分類違い（ftr の位置が幾何的には date）→ 矛盾ではない", () => {
    // 下端帯・左寄り（x<=0.3SW）＝幾何は date と読むが、footer と date は同じメタ帯クラス
    const r = detectPathologies(stub([mkLayout("L", [mkPh("ftr", "12", 0.5, 7.1, 4, 0.35, 10)])]), "s");
    expect(r.conflicts).toEqual([]);
  });

  it("body 型の下端メタ帯 → 矛盾ではない（ラダーが既に幾何で解決＝異議は捨てられていない）", () => {
    const r = detectPathologies(stub([mkLayout("L", [mkPh("body", "2", 0.6, 7.0, 12, 0.4, 10)])]), "s");
    expect(r.conflicts).toEqual([]);
  });

  it("小フォント（最大フォントでない）の subtitle 帯 body → 矛盾ではない（リード文の過検出防止）", () => {
    // 06_まとめ のリード文パターン: fs16 のワイド帯 + fs24 の title が同居
    const r = detectPathologies(
      stub([mkLayout("L", [mkPh("title", "0", 0.6, 0.3, 12.1, 0.8, 24), mkPh("body", "1", 0.6, 1.7, 12.1, 0.5, 16)])]),
      "s",
    );
    expect(r.conflicts).toEqual([]);
  });

  it("title 型が幾何的にも title 帯 → 矛盾ではない（一致）", () => {
    const r = detectPathologies(stub([mkLayout("L", [mkPh("title", "0", 0.6, 0.3, 12.1, 0.8, 28)])]), "s");
    expect(r.conflicts).toEqual([]);
  });

  // ── レビュー反映（敵対検証で確定した 4 クラス）──

  it("視覚型 ph の幻フォントは最大フォント比較を汚染しない（pic fs32 が body 見出し fs28 を隠さない）", () => {
    // loader は pic/chart/tbl にも継承 body フォントを stamp する（テキストは描画しないのに）。
    // 最大フォントのプールを text 系に限定しないと、実テンプレ（マガジン 10_画像３連 pic fs32）で
    // body 型見出しの矛盾クラスがまるごと隠れ、融合判断のデータが過小計上に偏る。
    const r = detectPathologies(
      stub([mkLayout("L", [mkPh("body", "1", 0.6, 0.35, 12.1, 0.8, 28), mkPh("pic", "20", 8, 2, 4, 3, 32)])]),
      "s",
    );
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ typeRole: "body", geoRole: "title", fs: 28 });
  });

  it("typeless×慣習 idx の下端帯 body → 矛盾（ラダーの幾何再分類は明示 body 型限定＝異議は捨てられている）", () => {
    // type="body" の下端帯はラダーが幾何で footer/date へ再分類する（＝異議は生きている）が、
    // typeless idx 1-9 は idx rung で body になり再分類されない → 幾何優先なら判定が変わる枠。
    const r = detectPathologies(stub([mkLayout("L", [mkPh("", "2", 0.5, 7.0, 3.0, 0.4, 12)])]), "s");
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ typeRole: "body", geoRole: "date", type: "" });
  });

  it("18pt 未満はレイアウト最大フォントでも見出し主張は決定的でない（chrome/リード帯の床）", () => {
    // fs>=18 床の単独 pin: fs12 が唯一＝最大フォントで title 帯にいる → それでも矛盾 0。
    const r = detectPathologies(stub([mkLayout("L", [mkPh("body", "1", 0.6, 0.35, 12.1, 0.8, 12)])]), "s");
    expect(r.conflicts).toEqual([]);
  });

  it("18pt+ でもレイアウト最大フォントでなければ見出し主張は決定的でない", () => {
    // fs===max 側の単独 pin: fs20 の title 帯 body ＋ fs28 の本物 title → 矛盾 0。
    const r = detectPathologies(
      stub([mkLayout("L", [mkPh("body", "1", 0.6, 0.35, 12.1, 0.8, 20), mkPh("title", "0", 0.6, 1.6, 12.1, 0.8, 28)])]),
      "s",
    );
    expect(r.conflicts).toEqual([]);
  });

  it("見出し型が下端メタ帯にいる → 矛盾（meta ゲートの正側）", () => {
    const r = detectPathologies(stub([mkLayout("L", [mkPh("title", "0", 0.6, 7.1, 4, 0.35, 10)])]), "s");
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ typeRole: "title", geoRole: "date" });
  });
});
