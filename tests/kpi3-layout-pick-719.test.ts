/**
 * kpi3-layout-pick-719.test.ts — #719: Pitch × manuscript-07 の KPI 3 つが KPI.4Value.Grid（2×2）に置かれ右下が空く。
 *
 * 原因: Pitch の採用レイアウト（template-presets.ts の PITCH_PRESET.layouts）に KPI.3Value.Equal が無く、
 * kpi 3 グループの受け皿が 4 マスの格子しか無かった。採用一覧に加えて、選択は既存の経路（autoSelectLayout）のまま。
 *
 *  - manuscript-07 の KPI 3 つ（8 枚目）→ KPI.3Value.Equal。
 *  - manuscript-05 の KPI 4 つ（9 枚目）→ KPI.4Value.Grid のまま（#695）。
 *  - KPI 5 つ → main と同じ Column.3Body.Equal のまま（kpi 枠が 5 以上のレイアウトが無いので group 経路を
 *    抜けて通常の選択へ。KPI.3Value.Equal を足しても「枠数 ≥ グループ数」の条件で候補にならない）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { PITCH_PRESET, writePresetTemplate } from "../src/engine/template-presets";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { measureTemplate } from "../scripts/style-metrics";

const CAMPAIGN_DECK = resolve(__dirname, "../samples/manuscript-07-campaign.md");
const PITCH_DECK = resolve(__dirname, "../samples/manuscript-05-sales-pitch.md");
const COVER = "# 表紙\n\nサブ\n\n---\n\n";
const kpiDeck = (n: number) =>
  COVER + "# K\n\n" + Array.from({ length: n }, (_, i) => `<!-- kpi -->\n### ラベル${i + 1}\n- ${i + 1}0%`).join("\n\n");

describe("#719 Pitch の KPI レイアウト選択はグループ数に合う", () => {
  let bytes: Uint8Array;
  let tpl: TemplateData;
  beforeAll(async () => {
    bytes = await writePresetTemplate(PITCH_PRESET);
    tpl = await loadTemplate(bytes);
  });

  it("manuscript-07 の 8 枚目（KPI 3 つ）は KPI.3Value.Equal", async () => {
    const m = await measureTemplate(readFileSync(CAMPAIGN_DECK, "utf8"), "pitch", bytes);
    expect(m.perSlide[7].layout).toBe("KPI.3Value.Equal");
  });

  it("manuscript-05 の 9 枚目（KPI 4 つ）は KPI.4Value.Grid のまま", async () => {
    const m = await measureTemplate(readFileSync(PITCH_DECK, "utf8"), "pitch", bytes);
    expect(m.perSlide[8].layout).toBe("KPI.4Value.Grid");
  });

  it("KPI 3・4・5 つ → 3Value.Equal・4Value.Grid・Column.3Body.Equal（4・5 は main と同じ）", () => {
    const catalog = buildCatalog(tpl);
    const pick = (n: number) => {
      const slides = parseMd(kpiDeck(n)).slides;
      return autoSelectLayout(slides[1], 1, slides.length, catalog);
    };
    expect([3, 4, 5].map(pick)).toEqual(["KPI.3Value.Equal", "KPI.4Value.Grid", "Column.3Body.Equal"]);
  });
});
