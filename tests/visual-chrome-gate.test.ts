/**
 * visual-chrome-gate.test.ts — #124: 図/表/コード/画像の配置先（body 序数）から chrome 帯を除外する。
 *
 * §2 部品2 の do-no-harm ゲート（#96）は bindContentByRole の Pass2＝**テキスト経路**にしか無く、
 * **visual 経路**（bodyPlaceholders → nthBody / imagePlaceholder）は素通りだった。結果、出荷テンプレ
 * 配布資料_公文書高密度 の 資料名スロット（idx=31 type="body" 3.10×0.62 @y=0.28 fs=9・scorer=chrome）が
 * 全レイアウトで body 序数に混ざり、最悪 05_比較表 では**唯一の body がその帯**＝比較表の表が
 * 3.1"×0.62" のヘッダー帯に描かれていた（＝誤注入）。
 *
 * 不変条件:
 *  - byte-identical はここでは**誤ったゲート**（序数が動くのが目的）。代わりに「動いたのは chrome 帯だけ」を
 *    専用 golden（BODY_ORDINALS）で示す——実 body の序数は 1 件も動かない。
 *  - no-silent-drop: 行き場を失った visual は**未束縛として報告**（unboundVisuals）。黙って捨てず、
 *    **勝手に全画面へ広げもしない**（図の「区画指定」を solo 化しない）。
 *  - chrome の定義は1本（scorer の inferredFunction）。テキスト経路と同じ signal を見る。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import type { PlaceholderInfo } from "../src/engine/template-loader";
import { bodyPlaceholders, nthBody, imagePlaceholder, unboundVisuals } from "../src/engine/placeholder-binding";
import { generatePptx } from "../src/engine/placeholder-filler";
import type { SlideIR, DeckIR } from "../src/engine/slide-schema";

const pub = (p: string) => resolve(__dirname, "../public/templates/slide", p);
const KOUBUN = pub("配布資料_公文書高密度_TemplateOnly.pptx");
const MAGAZINE = pub("ビジュアルデッキ_マガジン_TemplateOnly.pptx");

const st = (o: Partial<{ x: number; y: number; w: number; h: number; fontSize: number }> = {}) =>
  ({ x: 0, y: 0, w: 5, h: 3, fontSize: 14, fontColor: "000000", fontName: "", bold: false, align: "l", bulletChar: "", ...o }) as never;
const ph = (o: Partial<PlaceholderInfo>): PlaceholderInfo =>
  ({ idx: "1", type: "body", name: "", shapeXml: "", style: st(), metaIdxConvention: true, ...o }) as PlaceholderInfo;

// 実テンプレの 資料名スロット と同型: body 型・上端の細帯・極小フォント → scorer が chrome と stamp 済み。
const chromeBand = (idx: string) =>
  ph({ idx, name: "資料名スロット", style: st({ x: 9.73, y: 0.28, w: 3.1, h: 0.62, fontSize: 9 }), inferredFunction: "chrome" });
const realBody = (idx: string) =>
  ph({ idx, name: "本文", style: st({ x: 0.6, y: 1.85, w: 12.1, h: 4.9 }), inferredFunction: "primaryBody" });

describe("#124 bodyPlaceholders は chrome 帯を body 序数に入れない", () => {
  it("chrome 帯は body 序数から外れ、nthBody は実 body を返す", () => {
    const layout = [chromeBand("31"), realBody("1")];
    expect(bodyPlaceholders(layout).map((p) => p.idx)).toEqual(["1"]); // 31 は消える
    expect(nthBody(bodyPlaceholders(layout), "1")?.idx).toBe("1");
  });

  it("唯一の body が chrome 帯なら body 序数は空＝ nthBody は undefined（帯へは描かない）", () => {
    // 05_比較表 と同型。「そもそも body 枠であってはいけない帯」なので 1→0 が正。
    const layout = [chromeBand("31")];
    expect(bodyPlaceholders(layout)).toEqual([]);
    expect(nthBody(bodyPlaceholders(layout), "1")).toBeUndefined();
  });

  it("反実仮想: scorer 未 stamp なら帯が body 序数に入る（＝ゲートが効いている証拠）", () => {
    const layout = [ph({ idx: "31", name: "資料名スロット", style: st({ x: 9.73, y: 0.28, w: 3.1, h: 0.62, fontSize: 9 }) })];
    expect(bodyPlaceholders(layout).map((p) => p.idx)).toEqual(["31"]);
  });

  it("imagePlaceholder の body フォールバックも同じゲートを継承する", () => {
    const layout = [chromeBand("31"), realBody("1")];
    expect(imagePlaceholder(layout, "1")?.idx).toBe("1"); // 帯ではなく実 body
    expect(imagePlaceholder([chromeBand("31")], "1")).toBeUndefined(); // 帯しか無ければ行き場なし
  });

  it("メタロール（footer/date/番号）は無関係＝一律 chrome skip にしていない", () => {
    // 下端のメタ帯も scorer は chrome と読むが、そもそも role が body でないので body 序数とは無縁。
    const ftr = ph({ idx: "12", type: "ftr", style: st({ x: 4.6, y: 7.04, w: 4.1, h: 0.34, fontSize: 10 }), inferredFunction: "chrome" });
    expect(bodyPlaceholders([ftr, realBody("1")]).map((p) => p.idx)).toEqual(["1"]);
  });
});

describe("#124 no-silent-drop: 行き場の無い visual は未束縛として報告される", () => {
  const bandOnly = [chromeBand("31")]; // 05_比較表 と同型（実 body ゼロ）
  const slideWith = (v: Partial<SlideIR>): SlideIR => ({ layout: "X", placeholders: [], ...v }) as SlideIR;

  it("表は帯に描かれず、未束縛として報告される（黙って捨てない）", () => {
    const s = slideWith({ table: { rows: [["A", "B"]], header: true, placeholderIdx: "1" } });
    expect(unboundVisuals(s, bandOnly)).toEqual([{ kind: "table", placeholderIdx: "1" }]);
  });

  it("コードブロックも同様に報告される", () => {
    const s = slideWith({ code: { content: "x = 1", placeholderIdx: "1" } });
    expect(unboundVisuals(s, bandOnly)).toEqual([{ kind: "code", placeholderIdx: "1" }]);
  });

  it("区画指定の図（序数2+）は行き場が無ければ報告される——勝手に全画面へ広げない", () => {
    // 08_目次（bodies=1,31）で 31 を外すと nthBody("2") が undefined になる導線。ここで solo 扱いに
    // フォールバックすると図が本文（目次）を覆う＝新たな誤注入。よって「描かず報告」が正。
    const layout = [realBody("1"), chromeBand("31")];
    const s = slideWith({ diagram: { yaml: "type: diagram", placeholderIdx: "2" } });
    expect(unboundVisuals(s, layout)).toEqual([{ kind: "diagram", placeholderIdx: "2" }]);
  });

  it("solo 図（序数1）は全画面が本来の意図＝ body ゼロでも未束縛ではない", () => {
    const s = slideWith({ diagram: { yaml: "type: diagram", placeholderIdx: "1" } });
    expect(unboundVisuals(s, bandOnly)).toEqual([]);
  });

  it("behind 画像はレイヤー＝ placeholder に束縛されないので未束縛ではない", () => {
    const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    expect(unboundVisuals(slideWith({ image: { src: IMG, alt: "", placeholderIdx: "1", behind: true } }), bandOnly)).toEqual([]);
    expect(unboundVisuals(slideWith({ image: { src: IMG, alt: "", placeholderIdx: "1" } }), bandOnly))
      .toEqual([{ kind: "image", placeholderIdx: "1" }]); // 前面画像は行き場が必要
  });

  it("実 body があれば報告ゼロ（過剰報告しない）", () => {
    const s = slideWith({ table: { rows: [["A"]], header: true, placeholderIdx: "1" } });
    expect(unboundVisuals(s, [realBody("1"), chromeBand("31")])).toEqual([]);
  });
});

// ── 出荷テンプレでの golden 差分（「動いたのは chrome 帯だけ」を示す） ──
describe("#124 出荷テンプレ 配布資料_公文書高密度", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(KOUBUN));
  });

  // golden: 修正後の body 序数。31（資料名スロット）が全レイアウトから消える一方、
  // **実 body の序数は 1 件も動かない**（31 は常に末尾に整列していたため）。05_比較表 のみ 1→0。
  const BODY_ORDINALS: Record<string, string[]> = {
    "00_表紙": ["13", "14"], // 元から 31 を持たない＝完全不変
    "01_章扉": ["1"], // 同上
    "02_本文（３ブロック）": ["13", "14", "17", "18"], // was …,"31"
    "03_サマリと詳細": ["1", "2"], // was …,"31"
    "04_図＋説明": ["1", "2"], // was …,"31"
    "05_比較表": [], // was ["31"] — 唯一の body が chrome 帯だった（最悪ケース）
    "06_まとめ": ["1", "2", "3", "4"], // was …,"31"
    "07_コード／ログ": ["13"], // was …,"31"
    "08_目次": ["1"], // was ["1","31"] — nthBody("2") が帯を指していた
    "09_KPIハイライト": ["13", "14", "17", "18", "19", "20", "21"], // was …,"31"
    "10_カード3列": ["13", "14", "17", "18", "19", "20", "21"], // was …,"31"
    "11_プロセス": ["13", "14", "17", "18", "19", "20", "21", "22", "23", "24"], // was …,"31"
    "12_論点と対応": ["13", "14"], // was …,"31"
  };

  it("全レイアウトで 資料名スロット(31) が body 序数から消え、実 body の序数は不変", () => {
    for (const l of tpl.layouts) {
      const expected = BODY_ORDINALS[l.name];
      expect(expected, `golden に ${l.name} が必要`).toBeDefined();
      expect(bodyPlaceholders(l.placeholders).map((p) => p.idx), l.name).toEqual(expected);
    }
  });

  it("資料名スロット(31) は body 型だが scorer=chrome＝ゲートの前提が live", () => {
    const l = tpl.layouts.find((x) => x.name === "05_比較表")!;
    const band = l.placeholders.find((p) => p.idx === "31")!;
    expect(band.type).toBe("body"); // 明示型なのでロールラダー(#96)では塞げない
    expect(band.inferredFunction).toBe("chrome"); // load 時 stamp 済み
  });

  it("05_比較表: 表はヘッダー帯に描かれず、未束縛として報告される", async () => {
    const slide: SlideIR = {
      layout: "05_比較表",
      placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "プラン比較" }] }] }],
      table: { rows: [["プラン", "月額"], ["Pro", "¥1,200"]], header: true, placeholderIdx: "1" },
    } as SlideIR;
    const l = tpl.layouts.find((x) => x.name === "05_比較表")!;
    expect(unboundVisuals(slide, l.placeholders)).toEqual([{ kind: "table", placeholderIdx: "1" }]);

    const zip = await JSZip.loadAsync(await generatePptx({ slides: [slide] } as DeckIR, tpl));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).not.toContain("<a:tbl>"); // 帯（3.1"×0.62"）に表を描かない＝誤注入の根治
    expect(xml).not.toContain("¥1,200");
  });

  it("反実仮想: 実 body を持つレイアウトでは表は従来通り body#1 の矩形に入る（実 body は不変）", async () => {
    const slide: SlideIR = {
      layout: "03_サマリと詳細",
      placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "プラン比較" }] }] }],
      table: { rows: [["プラン", "月額"], ["Pro", "¥1,200"]], header: true, placeholderIdx: "1" },
    } as SlideIR;
    const zip = await JSZip.loadAsync(await generatePptx({ slides: [slide] } as DeckIR, tpl));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toContain("<a:tbl>");
    const body1 = tpl.layouts.find((x) => x.name === "03_サマリと詳細")!.placeholders.find((p) => p.idx === "1")!;
    expect(xml).toContain(`<a:off x="${Math.round(body1.style.x * 914400)}"`); // body#1 の矩形
  });
});

describe("#124 出荷テンプレ ビジュアルデッキ_マガジン: 表紙のメタ帯も body 序数から外れる", () => {
  it("00_表紙 の 唯一の body（メタ情報帯・下端 fs=12）は chrome＝ nthBody('1') は undefined", async () => {
    const tpl = await loadTemplate(readFileSync(MAGAZINE));
    const cover = tpl.layouts.find((l) => l.name === "00_表紙")!;
    const meta = cover.placeholders.find((p) => p.idx === "14")!;
    expect(meta.inferredFunction).toBe("chrome");
    expect(bodyPlaceholders(cover.placeholders)).toEqual([]);
    expect(nthBody(bodyPlaceholders(cover.placeholders), "1")).toBeUndefined();
  });
});
