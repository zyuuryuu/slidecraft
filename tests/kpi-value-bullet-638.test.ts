/**
 * kpi-value-bullet-638.test.ts — #638（#634 を集約）: KPI の値枠（大数字）の前に箇条記号「•」が描かれる。
 *
 * 値の行は md では箇条（`- **4.2 億円**`）なので、段落が `bullet: true` のまま値枠へ束縛され、書き出しは
 * `<a:pPr>` を付けずにマスターの本文スタイル（lvl1 が箇条）を継いでいた。値枠へ束縛する段落は箇条を外す
 * （書き出しで `<a:pPr><a:buNone/>`）。値枠の判定は group-layout の dominantValueSlot（markKpiValue と
 * 同じ 1 経路・R8）。
 *
 *  - canonical の KPI.*Value（値枠がラベルの上）: markKpiValue が role "value" を付けた枠。
 *  - 報告書・マガジンの 09_KPIハイライト / 05_ビッグナンバー（ラベルが値の上）: role は body のまま
 *    （tests/group-detect.test.ts が固定）だが、同じ dominantValueSlot が値枠と判定する枠。
 *  - ラベル（見出し）は従来どおり。
 *  - #645: 説明行（値以外の body 枠＝ValueDesc／KPI補足／補足）も箇条を外す（buNone）。KPI タイルの
 *    説明はキャプションであって箇条ではない。判定は group-layout の role（kpi グループの body）のみ（R8）。
 *  - KPI 以外のグループ（card / step / compare）の段落は変えない（slide XML は byte-identical）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";
import { expandGroups } from "../src/engine/group-binding";
import { writePresetTemplate, REPORT_PRESET } from "../src/engine/template-presets";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";

const REPORT = resolve(__dirname, "../public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx");
const MAGAZINE = resolve(__dirname, "../public/templates/slide/ビジュアルデッキ_マガジン_TemplateOnly.pptx");

const COVER = "# 表紙\n\nサブ\n\n---\n\n";
const KPI1 = COVER + "# 削減効果\n\n<!-- kpi -->\n### 年間コスト削減\n- **4.2 億円**\n- 平年度ベース";
const KPI3 =
  COVER +
  "# 3 つの効果\n\n<!-- kpi -->\n### コスト\n- −18%\n- 前年比\n\n<!-- kpi -->\n### 問い合わせ\n- 40% 減\n- 補足 1\n- 補足 2\n\n<!-- kpi -->\n### 立ち上がり\n- 2 週";
const CARDS = COVER + "# カード\n\n<!-- card -->\n### A\n- a1\n- a2\n\n<!-- card -->\n### B\n- b1\n\n<!-- card -->\n### C\n- c1";

const BU_NONE = "<a:pPr><a:buNone/></a:pPr>";

/** Paragraphs (`<a:p>…</a:p>`) of every shape on the LAST slide of the exported deck, keyed by shape name. */
async function lastSlideParas(md: string, tpl: TemplateData): Promise<Map<string, string[]>> {
  const deck = parseMd(md);
  const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
  const xml = await zip.file(`ppt/slides/slide${deck.slides.length}.xml`)!.async("string");
  const out = new Map<string, string[]>();
  for (const sp of xml.split("<p:sp>").slice(1)) {
    const name = /<p:cNvPr id="\d+" name="([^"]*)"/.exec(sp)?.[1];
    if (name) out.set(name, sp.match(/<a:p>.*?<\/a:p>/g) ?? []);
  }
  return out;
}

const tpls: Record<string, TemplateData> = {};
beforeAll(async () => {
  tpls.writerDefault = await loadTemplate(
    await writeTemplate({ name: "G", fonts: { major: "Georgia", minor: "Calibri" }, palette: { ...MIDNIGHT_PALETTE } }),
  );
  tpls.reportPreset = await loadTemplate(await writePresetTemplate(REPORT_PRESET));
  tpls.report = await loadTemplate(readFileSync(REPORT));
  tpls.magazine = await loadTemplate(readFileSync(MAGAZINE));
});

describe("#638 KPI の値枠の段落に buNone が付く", () => {
  for (const key of ["writerDefault", "reportPreset"] as const) {
    it(`KPI.1Value.Single（${key}）: 値・説明は buNone・ラベルは従来どおり`, async () => {
      const at = await lastSlideParas(KPI1, tpls[key]);
      expect(at.get("Value.Center")).toEqual([`<a:p>${BU_NONE}<a:r><a:rPr b="1"/><a:t>4.2 億円</a:t></a:r></a:p>`]);
      expect(at.get("ValueLabel.Center")).toEqual([`<a:p>${BU_NONE}<a:r><a:t>年間コスト削減</a:t></a:r></a:p>`]);
      // #645: 説明行も箇条を外す（マスター lvl1 の「•」を継がない）。
      expect(at.get("ValueDesc.Center")).toEqual([`<a:p>${BU_NONE}<a:r><a:t>平年度ベース</a:t></a:r></a:p>`]);
    });
  }

  it("KPI.3Value.Equal（REPORT_PRESET）: 3 つの値がすべて buNone", async () => {
    const at = await lastSlideParas(KPI3, tpls.reportPreset);
    expect(at.get("Value1")).toEqual([`<a:p>${BU_NONE}<a:r><a:t>−18%</a:t></a:r></a:p>`]);
    expect(at.get("Value2")).toEqual([`<a:p>${BU_NONE}<a:r><a:t>40% 減</a:t></a:r></a:p>`]);
    expect(at.get("Value3")).toEqual([`<a:p>${BU_NONE}<a:r><a:t>2 週</a:t></a:r></a:p>`]);
    // KPI.3 には説明枠が無いので、値より後の行はラベル枠へ（#593 の束縛・従来どおり）。箇条のまま。
    expect(at.get("Label1")).toEqual([
      `<a:p>${BU_NONE}<a:r><a:t>コスト</a:t></a:r></a:p>`,
      "<a:p><a:r><a:t>前年比</a:t></a:r></a:p>",
    ]);
  });

  for (const key of ["report", "magazine"] as const) {
    it(`09_KPIハイライト（${key}・ラベルが値の上）: 数値枠・補足は buNone・ラベルは従来どおり`, async () => {
      const at = await lastSlideParas(KPI3, tpls[key]);
      expect(at.get("KPI数値1")).toEqual([`<a:p>${BU_NONE}<a:r><a:t>−18%</a:t></a:r></a:p>`]);
      expect(at.get("KPI数値2")).toEqual([`<a:p>${BU_NONE}<a:r><a:t>40% 減</a:t></a:r></a:p>`]);
      expect(at.get("KPI数値3")).toEqual([`<a:p>${BU_NONE}<a:r><a:t>2 週</a:t></a:r></a:p>`]);
      expect(at.get("KPIラベル1")).toEqual([`<a:p>${BU_NONE}<a:r><a:t>コスト</a:t></a:r></a:p>`]);
      expect(at.get("KPI補足1")).toEqual([`<a:p>${BU_NONE}<a:r><a:t>前年比</a:t></a:r></a:p>`]);
      expect(at.get("KPI補足2")).toEqual([
        `<a:p>${BU_NONE}<a:r><a:t>補足 1</a:t></a:r></a:p>`,
        `<a:p>${BU_NONE}<a:r><a:t>補足 2</a:t></a:r></a:p>`,
      ]);
    });
  }

  it("05_ビッグナンバー（magazine・名前で認識する kpi 1 枠）: 大数字・補足は buNone", async () => {
    const at = await lastSlideParas(KPI1, tpls.magazine);
    expect(at.get("ビッグナンバー")).toEqual([`<a:p>${BU_NONE}<a:r><a:rPr b="1"/><a:t>4.2 億円</a:t></a:r></a:p>`]);
    expect(at.get("補足")).toEqual([`<a:p>${BU_NONE}<a:r><a:t>平年度ベース</a:t></a:r></a:p>`]);
  });
});

describe("#638 KPI 以外のグループは変えない", () => {
  it("card の本文段落は箇条のまま（expandGroups が bullet を保つ）", () => {
    const deck = parseMd(CARDS);
    const slide = deck.slides[deck.slides.length - 1];
    let checked = 0;
    for (const tpl of Object.values(tpls)) {
      const layout = tpl.layouts.find((l) => /Card|カード/i.test(l.name) && expandGroups(slide, l).size > 0);
      if (!layout) continue;
      checked++;
      const bodies = [...expandGroups(slide, layout).values()].flatMap((c) => c.paragraphs).filter((p) => /^[abc]\d$/.test(p.segments[0]?.text ?? ""));
      expect(bodies.length, `${layout.name}`).toBe(4);
      expect(bodies.every((p) => p.bullet === true), `${layout.name}`).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
