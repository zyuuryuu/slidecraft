/**
 * master-pathology.test.ts — 病理センサスの検出ロジック（src/engine/master-pathology.ts）。
 * 設計: docs/design/master-intake.md §3.2。
 *
 * 検証方針: (a) 既知の敵対 fixture で「仕込んだ病理」が検出されること、
 * (b) クリーンな同梱マスターで「確実系」病理がゼロであること（＝過検出しない）、
 * (c) 合成スタブで確実系（w/h=0・typeless・非16:9）を精密に検証。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";
import { detectPathologies } from "../src/engine/master-pathology";
import type { PlaceholderInfo } from "../src/engine/template-loader";

const fx = (p: string) => resolve(__dirname, "fixtures/templates", p);
const pub = (p: string) => resolve(__dirname, "../public/templates/slide", p);

describe("detectPathologies — 敵対 fixture の仕込み病理を検出", () => {
  it("Dirty_Adversarial: title=staticText / title=body / figure=body を検出", async () => {
    const tpl = await loadTemplate(readFileSync(fx("Dirty_Adversarial_TemplateOnly.pptx")));
    const r = detectPathologies(tpl, "Dirty_Adversarial");
    // Cover と 図レイアウトの見出しは placeholder でなく staticText
    expect(r.counts["title-as-static-text"] ?? 0).toBeGreaterThanOrEqual(2);
    // 3カラムの見出しは body 型（idx=10・上部・最大フォント）
    expect(r.counts["title-as-body"] ?? 0).toBeGreaterThanOrEqual(1);
    // 図枠は body 型（巨大面積×大フォント）
    expect(r.counts["figure-as-body"] ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe("detectPathologies — クリーンな同梱マスターで過検出しない", () => {
  it("Midnight_Executive: 確実系病理ゼロ・16:9", async () => {
    const tpl = await loadTemplate(readFileSync(pub("Midnight_Executive_30_TemplateOnly.pptx")));
    const r = detectPathologies(tpl, "Midnight");
    expect(r.counts["unresolved-geometry"] ?? 0).toBe(0); // 全 xfrm 解決済
    expect(r.counts["typeless-placeholder"] ?? 0).toBe(0); // 全 placeholder に type
    expect(r.counts["title-as-static-text"] ?? 0).toBe(0); // title は本物の placeholder
    expect(r.counts["non-standard-slide-size"] ?? 0).toBe(0); // 16:9
    expect(r.slideSize.w).toBeCloseTo(13.333, 1);
  });
});

// ── 合成スタブ（確実系を精密に）──
const mkPh = (type: string, idx: string, x: number, y: number, w: number, h: number, fs: number): PlaceholderInfo =>
  ({ idx, type, name: `n${idx}`, shapeXml: "", style: { x, y, w, h, fontSize: fs, fontColor: "000000", fontName: "", bold: false, align: "l", bulletChar: "" }, metaIdxConvention: false }) as unknown as PlaceholderInfo;
const mkLayout = (name: string, phs: PlaceholderInfo[]) =>
  ({ index: 1, name, placeholders: phs, decorations: [], images: [], staticTexts: [] });
const stub = (layouts: ReturnType<typeof mkLayout>[], sldSz = '<p:sldSz cx="12192000" cy="6858000"/>') =>
  ({ layouts, presentationXml: sldSz } as never);

describe("detectPathologies — 合成スタブ（確実系）", () => {
  it("w/h=0（継承未解決）を検出", () => {
    const r = detectPathologies(stub([mkLayout("L", [mkPh("body", "1", 0.5, 1.5, 0, 0, 14)])]), "s");
    expect(r.counts["unresolved-geometry"]).toBe(1);
  });
  it("非慣習 idx の typeless placeholder を検出（idx 1-9 の typeless は回収されるので除外）", () => {
    // idx=17（非慣習）→ 検出。idx=3（慣習・body 回収）→ 非検出。
    const r = detectPathologies(stub([mkLayout("L", [mkPh("", "17", 1, 1, 5, 1, 14), mkPh("", "3", 1, 3, 5, 1, 14)])]), "s");
    expect(r.counts["typeless-placeholder"]).toBe(1);
  });
  it("非 16:9（4:3）を検出", () => {
    const r = detectPathologies(stub([mkLayout("L", [mkPh("title", "0", 0.5, 0.3, 9, 1, 28)])], '<p:sldSz cx="9144000" cy="6858000"/>'), "s");
    expect(r.counts["non-standard-slide-size"]).toBe(1);
    expect(r.slideSize.w).toBeCloseTo(10, 1);
  });
  it("クリーンな 16:9 レイアウトは確実系ゼロ", () => {
    const r = detectPathologies(stub([mkLayout("L", [mkPh("title", "0", 0.5, 0.3, 12, 1, 28), mkPh("body", "1", 0.5, 1.6, 12, 4.5, 14)])]), "s");
    expect(r.total).toBe(0);
  });
});
