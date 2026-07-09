/**
 * master-geometry-relative.test.ts — F0b-slice-1: geometryRole の sldSz 相対化
 * （master-intake.md §2 部品0）。geometryRole の 13.333×7.5 ハードコードを実 sldSz 相対へ。
 *
 * 合否条件（doc の R4/R5 相当の慎重さ）:
 *   (a) 効果: 非16:9（A4）では相対化で役割が正しく変わる
 *   (b) 退行ゼロ: canonical 16:9 は slideSize を stamp せず既定値を使う＝完全 byte-identical
 *       （＋全既存テスト緑がゲート）
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";
import { placeholderRole } from "../src/engine/template-catalog";
import type { PlaceholderInfo } from "../src/engine/template-loader";

const fx = (p: string) => resolve(__dirname, "fixtures/templates", p);
const pub = (p: string) => resolve(__dirname, "../public/templates/slide", p);

// 非慣習 idx の typeless ph（→ 幾何回収ラダーに落ちる）。上部の広幅・低背の帯。
const mk = (slideSize?: { w: number; h: number }): PlaceholderInfo =>
  ({
    idx: "17", type: "", name: "box", shapeXml: "",
    style: { x: 0.5, y: 1.4, w: 10, h: 1.0, fontSize: 20, fontColor: "000000", fontName: "", bold: false, align: "l", bulletChar: "" },
    metaIdxConvention: false,
    slideSize,
  }) as unknown as PlaceholderInfo;

describe("geometryRole 相対化 — 効果（A4 で役割が正しく変わる）", () => {
  it("y=1.4 の帯: A4(8.27高)では title・16:9既定では subtitle に落ちる", () => {
    // A4: y1.4/8.27=16.9% ≤ 18% → title 帯。16:9既定: 1.4/7.5=18.7% > 18% → title 帯を外れ subtitle。
    expect(placeholderRole(mk({ w: 11.69, h: 8.27 }))).toBe("title");
    expect(placeholderRole(mk(undefined))).toBe("subtitle"); // 相対化前と同じ（既定 13.333×7.5）
  });
});

describe("geometryRole 相対化 — 退行ゼロ（canonical は stamp されない）", () => {
  it("16:9 同梱テンプレは slideSize 未 stamp（＝既定値経路＝byte-identical）", async () => {
    const tpl = await loadTemplate(readFileSync(pub("Midnight_Executive_30_TemplateOnly.pptx")));
    const all = tpl.layouts.flatMap((l) => l.placeholders);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((p) => p.slideSize === undefined)).toBe(true); // canonical → 未 stamp
  });
  it("非16:9（velis A4）は slideSize を stamp する", async () => {
    const tpl = await loadTemplate(readFileSync(fx("lrk-slides-velis_CC0.pptx")));
    const stamped = tpl.layouts.flatMap((l) => l.placeholders).filter((p) => p.slideSize);
    expect(stamped.length).toBeGreaterThan(0);
    expect(stamped[0].slideSize!.h).toBeGreaterThan(7.6); // A4 landscape ~8.27（16:9 の 7.5 でない）
  });
});
