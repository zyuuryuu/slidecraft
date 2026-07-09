/**
 * master-scorer.test.ts — F1-① 決定論スコアラー（master-intake.md §2 部品1）。
 * プロトタイプの 5/5（敵対 fixture で title+primary body+chrome 除外）を golden として固定。
 * ＋ 全部乗せで chrome 硬除外・読み順・confidence の健全性。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type LayoutInfo, type PlaceholderInfo } from "../src/engine/template-loader";
import { inferFunction, chromePlaceholderIdxs, type ScoredElement } from "../src/engine/master-scorer";

const fx = (p: string) => resolve(__dirname, "fixtures/templates", p);
const pub = (p: string) => resolve(__dirname, "../public/templates/slide", p);
const titleOf = (s: ScoredElement[]) => s.find((e) => e.fn === "title");

describe("inferFunction — 敵対 fixture で title/primary body/chrome を復元（golden 5/5）", () => {
  it("Dirty_Adversarial の4レイアウトを正しく分類", async () => {
    const tpl = await loadTemplate(readFileSync(fx("Dirty_Adversarial_TemplateOnly.pptx")));
    const byName = new Map(tpl.layouts.map((l) => [l.name, inferFunction(l)]));

    // Cover: title は生テキストボックス
    const cover = byName.get("1_カスタム レイアウト")!;
    expect(titleOf(cover)?.text).toContain("2026 事業戦略");
    expect(titleOf(cover)?.source).toBe("static");

    // 3カラム: title は body 型 placeholder(idx10)
    const cols = byName.get("Custom Layout 2")!;
    expect(titleOf(cols)?.source).toBe("placeholder");
    expect(titleOf(cols)?.idx).toBe("10");
    expect(cols.some((e) => e.fn === "primaryBody")).toBe(true); // カラムが本文

    // 図: title は生テキスト・図枠(idx1)は figure
    const fig = byName.get("レイアウト 3")!;
    expect(titleOf(fig)?.text).toContain("図：システム");
    expect(fig.find((e) => e.idx === "1")?.fn).toBe("figure");

    // 章扉: title は body(idx1)"第3章"・"03" は accent（装飾＝content でない）
    const sec = byName.get("カスタム 4")!;
    expect(titleOf(sec)?.idx).toBe("1");
    expect(sec.find((e) => e.text === "03")?.fn).toBe("accent");

    // どのレイアウトも title を1つ特定できている（0/4 → 5/5 の要）
    expect([cover, cols, fig, sec].every((s) => titleOf(s))).toBe(true);
  });
});

// ── 全部乗せ（クリーン）: chrome 硬除外の証拠 ──
const mkPh = (type: string, idx: string, x: number, y: number, w: number, h: number, fs: number): PlaceholderInfo =>
  ({ idx, type, name: type, shapeXml: "", style: { x, y, w, h, fontSize: fs, fontColor: "0", fontName: "", bold: false, align: "l", bulletChar: "" } }) as unknown as PlaceholderInfo;
const mkLayout = (placeholders: PlaceholderInfo[]): LayoutInfo =>
  ({ index: 1, name: "full", placeholders, decorations: [], images: [], staticTexts: [] }) as unknown as LayoutInfo;

describe("inferFunction — 全部乗せで chrome を content から硬除外", () => {
  const layout = mkLayout([
    mkPh("title", "0", 0.5, 0.3, 12.3, 1.0, 28),
    mkPh("subTitle", "1", 0.5, 1.3, 12.3, 0.6, 16),
    mkPh("body", "2", 0.5, 2.1, 12.3, 4.2, 14),
    mkPh("hdr", "3", 0.5, 0.05, 12.3, 0.25, 10), // ヘッダー帯
    mkPh("ftr", "4", 0.5, 7.0, 4.0, 0.3, 10),
    mkPh("dt", "5", 9.5, 7.0, 3.0, 0.3, 10),
    mkPh("sldNum", "6", 12.3, 7.0, 0.8, 0.3, 10),
  ]);

  it("title=title・primaryBody=body・header/footer/date/num は chrome", () => {
    const s = inferFunction(layout);
    expect(titleOf(s)?.idx).toBe("0");
    expect(s.find((e) => e.idx === "2")?.fn).toBe("primaryBody");
    // header(3)/footer(4)/date(5)/num(6) は全て chrome → content ターゲットから除外される
    expect(chromePlaceholderIdxs(s)).toEqual(new Set(["3", "4", "5", "6"]));
  });

  it("読み順は左上→右下で単調・title の confidence は高い", () => {
    const s = inferFunction(layout);
    for (let i = 1; i < s.length; i++) expect(s[i].reading).toBeGreaterThan(s[i - 1].reading);
    expect(titleOf(s)!.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe("inferFunction — クリーン同梱でも title を高 confidence で特定", () => {
  it("Midnight 表紙: title を特定・確信度高", async () => {
    const tpl = await loadTemplate(readFileSync(pub("Midnight_Executive_30_TemplateOnly.pptx")));
    const cover = tpl.layouts.find((l) => /cover|表紙|title/i.test(l.name)) ?? tpl.layouts[0];
    const t = titleOf(inferFunction(cover));
    expect(t).toBeTruthy();
    expect(t!.confidence).toBeGreaterThanOrEqual(0.7);
  });
});
