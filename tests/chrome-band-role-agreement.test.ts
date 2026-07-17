/**
 * chrome-band-role-agreement.test.ts — #96: 幅広ヘッダー帯の title 誤認を根治する。
 *
 * 根本原因は「ロールラダーと scorer の不一致」。running header（端寄り・低背・極小フォントの帯）を
 * scorer(inferFunction) は chrome と判定するのに、placeholderRole の RECOVERY ラダー
 * （type 空 or 非規約 idx でのみ到達）は同じ帯を title と読んでいた。すると:
 *   (a) title 枠が「既存」扱い → 本来の見出しが復元されない（recoverLayoutTitle も scorer 復元も gate off）
 *   (b) title content の行き場が失われ、本文が見出し枠へ1つズレて流れ込む
 *
 * 対処: chrome 帯の判定式を master-scorer から1本だけ export（isChromeBand）し、ラダー側でも尊重する。
 * 幾何 rung だけを塞ぐのでは不十分——「資料タイトル」等の名前 rung で同じバグが再発するため、
 * RECOVERY の T3幾何/T4名前/T5面積 をまとめて塞ぐ。
 *
 * 不変条件:
 *   - 健全テンプレは byte-identical（同梱テンプレに「chrome 帯 かつ RECOVERY 到達」は 0 件。全既存テストがゲート）
 *   - do-no-harm: chrome には content を絶対入れない（"other" 化で gate 対象から外れる穴も塞ぐ）
 *   - no-silent-drop: 束縛できない content は未束縛として報告される
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { placeholderRole, recoverLayoutTitle } from "../src/engine/template-catalog";
import { bindContentByRole, unboundContent } from "../src/engine/placeholder-binding";
import { loadTemplate } from "../src/engine/template-loader";
import type { PlaceholderInfo } from "../src/engine/template-loader";
import type { SlideIR } from "../src/engine/slide-schema";

const st = (o: Partial<{ x: number; y: number; w: number; h: number; fontSize: number }> = {}) =>
  ({ x: 0, y: 0, w: 0, h: 0, fontSize: 18, fontColor: "000000", fontName: "", bold: false, align: "l", bulletChar: "", ...o }) as never;
// idx は非規約（20番台）＝ RECOVERY ラダーに落ちる。metaIdxConvention は canonical 既定。
const ph = (o: Partial<PlaceholderInfo>): PlaceholderInfo => ({
  idx: "20", type: "", name: "", shapeXml: "", style: st(), metaIdxConvention: true, ...o,
});

// 実テンプレにある running header: 上端・幅広・低背・極小フォント。
// w=12.3 は geometryRole の title 判定（w ≥ 0.55*13.333 = 7.33）に合致してしまう寸法。
const wideHeaderGeo = st({ x: 0.5, y: 0.12, w: 12.3, h: 0.26, fontSize: 10 });
const narrowHeaderGeo = st({ x: 0.5, y: 0.12, w: 6, h: 0.26, fontSize: 10 });

describe("#96 RECOVERY ラダーは chrome 帯を content ロールにしない", () => {
  it("幅広 running header は title でなく other（幾何 rung＝報告された症状）", () => {
    expect(placeholderRole(ph({ type: "hdr", name: "オブジェクト 3", style: wideHeaderGeo }))).toBe("other");
  });

  it("「資料タイトル」名の header は title でなく other（名前 rung＝幾何だけ塞いでも再発する経路）", () => {
    // 幅は狭く geometryRole は null → 従来は nameRole が /タイトル/ に反応して title を返していた。
    expect(placeholderRole(ph({ type: "hdr", name: "資料タイトル", style: narrowHeaderGeo }))).toBe("other");
  });

  it("帯は body にもならない（面積 rung＝bodyCount を汚さない）", () => {
    // 12.3*0.26 = 3.2 ≥ 1.0 で従来は T5 面積 rung が body を返していた。
    expect(placeholderRole(ph({ type: "hdr", name: "オブジェクト 3", style: wideHeaderGeo }))).not.toBe("body");
  });

  it("退行ゼロ: 下端 chrome 帯は従来通り footer/date/slideNumber を回収する（メタ判定が guard より先）", () => {
    // 下端帯は「chrome 帯」でもある。guard を先に置くと 127 件（Midnight/velis の型崩れ経路）が
    // other へ落ち、スライド番号帯に編集フィールドが生えるなどの退行になる。
    const strip = (o: Partial<{ x: number; w: number }>) =>
      ph({ idx: "21", style: st({ y: 7.04, h: 0.34, fontSize: 10, ...o }) });
    expect(placeholderRole(strip({ x: 0.5, w: 3 }))).toBe("date");
    expect(placeholderRole(strip({ x: 4.6, w: 4.1 }))).toBe("footer");
    expect(placeholderRole(strip({ x: 10.3, w: 2.5 }))).toBe("slideNumber");
  });

  it("反実仮想: 同じ形でも本物の title（大フォント）は title のまま＝fontSize が効いている", () => {
    // 幅広・上部・低背は title と header で同一。分離点は極小フォント（≤12pt）。
    const realTitle = ph({ type: "", name: "見出し", style: st({ x: 0.5, y: 0.12, w: 12.3, h: 1.0, fontSize: 28 }) });
    expect(placeholderRole(realTitle)).toBe("title");
  });
});

describe("#96 recoverLayoutTitle は chrome 帯を title に昇格しない", () => {
  it("idx=0 の「資料タイトル」header は昇格せず、本物の見出しが title を取る", () => {
    // 帯が other 化すると recoverLayoutTitle の昇格可能集合（body/other）に入ってしまう穴。
    const band = ph({ idx: "0", type: "hdr", name: "資料タイトル", style: wideHeaderGeo });
    const heading = ph({ idx: "1", type: "body", name: "タイトル", style: st({ x: 0.6, y: 0.72, w: 12.1, h: 0.9, fontSize: 24 }) });
    recoverLayoutTitle([band, heading]);
    expect(placeholderRole(band)).not.toBe("title"); // chrome へは絶対に昇格しない
    expect(placeholderRole(heading)).toBe("title"); // 本来の見出しが title を取る
  });
});

describe("#96 do-no-harm: other 化した帯にも content は入らない", () => {
  const chromeBand = (): PlaceholderInfo =>
    ph({ idx: "20", type: "hdr", name: "オブジェクト 3", style: wideHeaderGeo, inferredFunction: "chrome" });
  const content = (idx: string, text: string) => ({ idx, paragraphs: [{ segments: [{ text }] }] });

  it("role=other の帯は Pass2 の other content を受けない（other 化で gate 対象から外れる穴）", () => {
    // 資料番号(idx13)をユーザが入力 → レイアウト切替で idx-exact が効かず Pass2 の role=other に落ちる導線。
    const layout = [chromeBand(), ph({ idx: "1", type: "body", style: st({ x: 0.6, y: 1.85, w: 12.1, h: 4.9, fontSize: 14 }) })];
    const s = { layout: "X", placeholders: [content("13", "DOC-042")] } as unknown as SlideIR;
    expect(bindContentByRole(s, layout).has("20")).toBe(false);
    expect(unboundContent(s, layout).map((u) => u.content.idx)).toEqual(["13"]); // 黙って捨てず報告
  });

  it("型付き chrome（ftr/dt/sldNum）は従来通りメタ content を受ける（一律 skip にしない証拠）", () => {
    const ftr = ph({ idx: "12", type: "ftr", style: st({ x: 4.6, y: 7.04, w: 4.1, h: 0.34, fontSize: 10 }), inferredFunction: "chrome" });
    const layout = [ftr, ph({ idx: "1", type: "body", style: st({ x: 0.6, y: 1.85, w: 12.1, h: 4.9, fontSize: 14 }) })];
    const s = { layout: "X", placeholders: [content("12", "社外秘")] } as unknown as SlideIR;
    expect(bindContentByRole(s, layout).get("12")?.paragraphs[0].segments[0].text).toBe("社外秘");
  });
});

// ── 実テンプレ（loader 経由）での end-to-end ──
const messy = resolve(__dirname, "../test-data/master-intake/messy-corporate.pptx");

describe.skipIf(!existsSync(messy))("#96 実テンプレ: 幅広ヘッダー付きレイアウトで見出し復元＋束縛が成立", () => {
  it("見出し(body型)→title 復元・title/本文が正しい枠へ・chrome へ漏れ 0・未束縛 0", async () => {
    const tpl = await loadTemplate(readFileSync(messy));
    const l = tpl.layouts.find((x) => x.name === "本文（幅広ヘッダー）");
    expect(l, "fixture に 本文（幅広ヘッダー） レイアウトが必要").toBeTruthy();
    const byIdx = (i: string) => l!.placeholders.find((p) => p.idx === i)!;

    // 帯は scorer=chrome かつ role も content でない（＝ラダーと scorer が一致）
    expect(byIdx("20").inferredFunction).toBe("chrome");
    expect(placeholderRole(byIdx("20"))).toBe("other");
    // 見出し(body型・汎用名)は scorer 復元で title を取る
    expect(placeholderRole(byIdx("1"))).toBe("title");

    const slide = {
      layout: l!.name,
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "見出しテキスト" }] }] },
        { idx: "1", paragraphs: [{ segments: [{ text: "本文テキスト" }] }] },
      ],
    } as unknown as SlideIR;
    const bound = bindContentByRole(slide, l!.placeholders);
    expect(bound.get("1")?.paragraphs[0].segments[0].text).toBe("見出しテキスト"); // title → 見出し枠
    expect(bound.get("2")?.paragraphs[0].segments[0].text).toBe("本文テキスト"); // body → 本文枠（ズレない）
    expect(bound.has("20")).toBe(false); // header へは漏れない
    expect(unboundContent(slide, l!.placeholders)).toEqual([]); // 未束縛 0
  });
});
