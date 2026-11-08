/**
 * style-metrics-images-671.test.ts — #671: 画像面積比（imageArea）は「export が描く画像すべて」を数える。
 *
 * 旧実装は `slide.image`（1 枚目の画像だけを持つ単数フィールド）を読んでいたため、Campaign 目標デッキ
 * （samples/manuscript-07-campaign.md）の 2×2 グリッドが 0.141、並置 2 枚が 0.288 にしか計上されず、
 * デッキ平均が 0.185 になっていた。配置の正は #392 段 2 の figureRegions（export の planSlideFigures が
 * これを読む）なので、計測も同じ計画を読む（R8: 第 2 の列挙を作らない）。
 *
 *  (a) 回帰: 旧値 0.185 が再現しない・グリッド／並置スライドが全枠込みで計上される。
 *  (b) 一致テスト（R8）: 各スライドの imageArea ＝ 書き出した PPTX の <p:pic> の面積の和（÷ スライド面積）。
 *  (c) whitespace の ink にも全画像が入る（1 − whitespace ≥ imageArea）。
 *  (d) golden: pitch／executive の目標デッキの値と evaluateTargets（pitch／report／executive）は不変。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { CAMPAIGN_PRESET, PITCH_PRESET, EXECUTIVE_PRESET, writePresetTemplate } from "../src/engine/template-presets";
import { SLIDE_IN } from "../src/engine/visual-placement";
import * as S from "../src/mcp/session";
import { measureTemplate, styleMetrics, evaluateTargets, type TemplateMetrics } from "../scripts/style-metrics";

const ROOT = resolve(__dirname, "..");
const md = (name: string) => readFileSync(resolve(ROOT, "samples", name), "utf8");
const CAMPAIGN_MD = "manuscript-07-campaign.md";
const PITCH_MD = "manuscript-05-sales-pitch.md";
const EXEC_MD = "manuscript-06-executive-brief.md";
const EMU_PER_IN = 914400;

let campaign: Uint8Array, pitch: Uint8Array, executive: Uint8Array;
let cm: TemplateMetrics;
beforeAll(async () => {
  [campaign, pitch, executive] = await Promise.all([CAMPAIGN_PRESET, PITCH_PRESET, EXECUTIVE_PRESET].map((p) => writePresetTemplate(p)));
  cm = await measureTemplate(md(CAMPAIGN_MD), "campaign", campaign);
});

describe("(a) 回帰: 1 枚目だけを数えていた旧値が再現しない", () => {
  it("2×2 グリッド（4 枚）と並置 2 枚は全枠込みで計上され、デッキ平均は旧値 0.185 ではない", () => {
    expect(cm.perSlide[5].layout).toBe("Gallery.4Image.Grid");
    expect(cm.perSlide[6].layout).toBe("Gallery.2Image.Equal");
    expect(cm.perSlide[5].imageArea).not.toBeCloseTo(0.141, 3); // 旧: 1 枚目だけ
    expect(cm.perSlide[6].imageArea).not.toBeCloseTo(0.288, 3);
    expect(cm.perSlide[5].imageArea).toBeCloseTo(0.565, 3);
    expect(cm.perSlide[6].imageArea).toBeCloseTo(0.575, 3);
    expect(cm.imageAreaRatio).not.toBeCloseTo(0.185, 3);
    expect(cm.imageAreaRatio).toBeCloseTo(0.256, 3);
  });
});

describe("(b) 一致テスト（R8）: imageArea ＝ 書き出した PPTX の画像面積", () => {
  it("各スライドの imageArea が <p:pic> の ext の面積の和と一致する", async () => {
    const s = S.createSession(null);
    await S.newProject(s, campaign, md(CAMPAIGN_MD));
    const z = await JSZip.loadAsync((await S.exportPptxBytes(s)).bytes);
    const slideArea = SLIDE_IN.w * SLIDE_IN.h;
    for (let i = 0; i < cm.perSlide.length; i++) {
      const xml = await z.file(`ppt/slides/slide${i + 1}.xml`)!.async("string");
      const pics = xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? [];
      const area = pics.reduce((n, p) => {
        const m = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(p)!;
        return n + (Number(m[1]) / EMU_PER_IN) * (Number(m[2]) / EMU_PER_IN);
      }, 0);
      expect(cm.perSlide[i].imageArea, `slide ${i + 1}`).toBeCloseTo(Math.min(1, area / slideArea), 3);
    }
  });
});

describe("(c) whitespace の ink にも全画像が入る", () => {
  it("どのスライドも 1 − whitespace ≥ imageArea（画像が描かれた面は余白に数えない）", () => {
    for (const [i, p] of cm.perSlide.entries()) expect(1 - p.whitespace, `slide ${i + 1}`).toBeGreaterThanOrEqual(p.imageArea - 0.01);
  });
});

describe("(d) golden: 他スタイルの目標デッキは不変", () => {
  it("Pitch 目標デッキ: 画像は 1 枚ずつなので値は修正前と同じ・pitch／report の判定は緑のまま", async () => {
    const report = await styleMetrics("manuscript-05", md(PITCH_MD), [{ name: "pitch", bytes: pitch }]);
    const t = report.templates[0];
    expect(t.imageAreaRatio).toBe(0.025);
    expect(t.perSlide.map((p) => p.imageArea)).toEqual([0, 0, 0, 0, 0.216, 0, 0, 0, 0, 0, 0.128, 0, 0, 0]);
    expect(evaluateTargets(report, "pitch")).toEqual([{ template: "pitch", misses: [] }]);
    expect(evaluateTargets(report, "report")).toEqual([{ template: "pitch", misses: [] }]);
  });

  it("Executive 目標デッキ: 画像なし（0）・executive の判定は緑のまま", async () => {
    const report = await styleMetrics("manuscript-06", md(EXEC_MD), [{ name: "executive", bytes: executive }]);
    expect(report.templates[0].imageAreaRatio).toBe(0);
    expect(evaluateTargets(report, "executive")).toEqual([{ template: "executive", misses: [] }]);
  });

  it("marketing の画像帯は Pitch／Executive の目標デッキを通さない（帯がマーケを見分ける）", async () => {
    for (const [name, deck, bytes] of [["pitch", PITCH_MD, pitch], ["executive", EXEC_MD, executive]] as const) {
      const report = await styleMetrics(name, md(deck), [{ name, bytes }]);
      expect(evaluateTargets(report, "marketing")[0].misses.some((m) => m.startsWith("imageAreaRatio")), name).toBe(true);
    }
  });
});
