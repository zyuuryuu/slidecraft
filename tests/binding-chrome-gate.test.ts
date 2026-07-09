/**
 * binding-chrome-gate.test.ts — F1-②b do-no-harm ゲート（master-intake.md §2 部品2）。
 * スコアラーが chrome と判定した placeholder（誤ラベル header 等）には MUST ティア content
 * （title/body）を絶対に入れない。content は次の実 body へ流れる（or 未束縛として報告）。
 * 健全テンプレ（chrome=メタロール）では no-op＝byte-identical（全既存テストがゲート）。
 */
import { describe, it, expect } from "vitest";
import { bindContentByRole, unboundContent } from "../src/engine/placeholder-binding";
import type { PlaceholderInfo } from "../src/engine/template-loader";
import type { SlideIR } from "../src/engine/slide-schema";

// header は type=body に化けている（現行 placeholderRole は body）。scorer が chrome と stamp した想定。
const ph = (type: string, idx: string, chrome = false): PlaceholderInfo =>
  ({
    idx, type, name: `n${idx}`, shapeXml: "",
    style: { x: 0, y: 0, w: 5, h: 3, fontSize: 14, fontColor: "0", fontName: "", bold: false, align: "l", bulletChar: "" },
    ...(chrome ? { inferredFunction: "chrome" as const } : {}),
  }) as unknown as PlaceholderInfo;
const content = (idx: string, text: string) => ({ idx, paragraphs: [{ segments: [{ text }] }] });
const slide = (cs: ReturnType<typeof content>[]): SlideIR => ({ layout: "auto", placeholders: cs });

describe("do-no-harm ゲート — body content は chrome 枠に入らない", () => {
  // 実 body(idx1) ＋ header(idx3, body型だが scorer=chrome)。body content 2件。
  const layout = [ph("body", "1"), ph("body", "3", true)];
  const s = slide([content("1", "本文A"), content("2", "本文B")]);

  it("ゲート有: header(chrome) は content を受けず、溢れは未束縛として報告", () => {
    const bound = bindContentByRole(s, layout);
    expect(bound.get("1")?.paragraphs[0].segments[0].text).toBe("本文A"); // 実 body に A
    expect(bound.has("3")).toBe(false); // chrome header には入らない（← 根治点）
    const u = unboundContent(s, layout);
    expect(u.map((x) => x.content.idx)).toEqual(["2"]); // B は行き場が無く報告される
  });

  it("反実仮想: scorer 未 stamp なら header に流れ込む（＝ゲートが効いている証拠）", () => {
    const noChrome = [ph("body", "1"), ph("body", "3")]; // inferredFunction 無し
    const bound = bindContentByRole(s, noChrome);
    expect(bound.get("3")?.paragraphs[0].segments[0].text).toBe("本文B"); // ゲート無しなら B が header へ
  });

  it("メタロール（chrome=footer）は従来通り footer content を受ける（byte-identical）", () => {
    const layout2 = [ph("body", "1"), ph("ftr", "12", true)]; // ftr → role footer, scorer=chrome
    const s2 = slide([content("1", "本文"), content("12", "フッター")]);
    const bound = bindContentByRole(s2, layout2);
    expect(bound.get("12")?.paragraphs[0].segments[0].text).toBe("フッター"); // メタは通す
  });
});
