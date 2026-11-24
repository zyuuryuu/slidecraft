/**
 * kpi-grid-value-695.test.ts — #695: KPI.4Value.Grid（KPI 4 つの格子）で値が強調されない。
 *
 * 内蔵定義が「各セル 14pt・太字なし・左寄せの 1 枠」だけで値枠が無く、markKpiValue（値枠＝フォントが優勢な
 * 枠）が値の役を付けられなかった。裁定 A: レイアウト定義を KPI.1〜3 と同じ「値枠＋ラベル枠」の対にする。
 *
 *  (a) markKpiValue が KPI.4Value.Grid の 4 グループすべてに `role: "value"` を付ける（束縛・溢れ検出・
 *      プレビューは group-layout の判定 1 つを読む＝KPI.4 専用の分岐は無い・R8）。
 *  (b) Pitch × samples/manuscript-05-sales-pitch.md の 9 枚目（KPI 4 つ）で、値の段落はラベルと別の枠に 1 段落で
 *      入り、その枠は 40pt 以上・太字・emphasis 色。全レイアウトを持つ技術報告プリセットの KPI 4 つも同じ。
 *      Pitch × manuscript-07 の KPI 3 つ（campaign-preset-598 が測るスライド）は #719 以降 KPI.3Value.Equal に
 *      入る（格子ではない）ので、その枠で同じ強調を確かめる。
 *      Executive／Campaign プリセットは KPI.4Value.Grid を採用していない（template-presets.ts の layouts）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";
import { detectGroups } from "../src/engine/group-layout";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";
import { writePresetTemplate, PITCH_PRESET, REPORT_PRESET, type StylePreset } from "../src/engine/template-presets";

const DECK = resolve(__dirname, "../samples/manuscript-05-sales-pitch.md");
const CAMPAIGN_DECK = resolve(__dirname, "../samples/manuscript-07-campaign.md");
const COVER = "# 表紙\n\nサブ\n\n---\n\n";
const KPI4 = COVER + "# K\n\n" + ["4.2 億円", "−18%", "3 週 → 2 週", "12 カ月"].map((v, i) => `<!-- kpi -->\n### ラベル${i + 1}\n- ${v}\n- 説明${i + 1}`).join("\n\n");

/** slide N の各 shape: 名前・ph idx・段落テキスト。 */
async function slideShapes(md: string, tpl: TemplateData, n?: number) {
  const deck = parseMd(md);
  const k = n ?? deck.slides.length;
  const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
  const xml = await zip.file(`ppt/slides/slide${k}.xml`)!.async("string");
  return xml.split("<p:sp>").slice(1).map((sp) => ({
    name: /<p:cNvPr id="\d+" name="([^"]*)"/.exec(sp)?.[1] ?? "",
    idx: /<p:ph [^>]*idx="(\d+)"/.exec(sp)?.[1],
    paras: (sp.match(/<a:p>.*?<\/a:p>/g) ?? []).map((p) => (p.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.replace(/<\/?a:t>/g, "")).join("")),
    runSizes: [...sp.matchAll(/<a:rPr[^>]*\ssz="(\d+)"/g)].map((m) => Number(m[1]) / 100),
  }));
}

/** 値の段落が、それだけで入っている枠の書式（レイアウト側の継承値）が強調になっていること。 */
async function expectEmphasizedValues(md: string, preset: StylePreset, values: string[], n?: number, layoutName = "KPI.4Value.Grid") {
  const tpl = await loadTemplate(await writePresetTemplate(preset));
  const shapes = await slideShapes(md, tpl, n);
  const layout = tpl.layouts.find((l) => l.name === layoutName)!;
  for (const v of values) {
    const sh = shapes.find((s) => s.paras.includes(v));
    expect(sh, v).toBeDefined();
    expect(sh!.paras, `${v} は値枠に 1 段落だけ`).toEqual([v]);
    const ph = layout.placeholders.find((p) => p.idx === sh!.idx)!;
    expect(ph, `${v} の枠は ${layoutName} の枠`).toBeDefined();
    expect(ph.style.fontSize).toBeGreaterThanOrEqual(40);
    expect(ph.style.bold).toBe(true);
    expect(ph.style.fontColor.toUpperCase()).toBe(preset.palette.emphasis.toUpperCase());
    for (const sz of sh!.runSizes) expect(sz).toBeGreaterThanOrEqual(40); // run 側で小さく上書きしない
  }
}

describe("#695 (a) markKpiValue が KPI.4Value.Grid の 4 グループすべてに値枠を付ける", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(await writeTemplate({ name: "G", fonts: { major: "Georgia", minor: "Calibri" }, palette: { ...MIDNIGHT_PALETTE } }));
  });

  it("kpi・4 グループで、各グループにちょうど 1 つの value 枠と 1 つの heading 枠（ラベル）", () => {
    const layout = tpl.layouts.find((l) => l.name === "KPI.4Value.Grid")!;
    const shape = detectGroups(layout)!;
    expect(shape.kind).toBe("kpi");
    expect(shape.groups).toHaveLength(4);
    for (const g of shape.groups) {
      expect(g.filter((s) => s.role === "value")).toHaveLength(1);
      expect(g.filter((s) => s.role === "heading")).toHaveLength(1);
    }
  });

  it("4 つの値枠は格子の 4 セル（左上・右上・左下・右下の順）で、各ラベル枠は同じセルの値枠の真下", () => {
    const layout = tpl.layouts.find((l) => l.name === "KPI.4Value.Grid")!;
    const shape = detectGroups(layout)!;
    const ph = (idx: string) => layout.placeholders.find((p) => p.idx === idx)!.style;
    const cells = shape.groups.map((g) => ({ v: ph(g.find((s) => s.role === "value")!.phIdx), l: ph(g.find((s) => s.role === "heading")!.phIdx) }));
    const [tl, tr, bl, br] = cells.map((c) => c.v);
    expect(tl.x).toBeLessThan(tr.x);
    expect(tl.y).toBeCloseTo(tr.y, 2);
    expect(bl.x).toBeCloseTo(tl.x, 2);
    expect(bl.y).toBeGreaterThan(tl.y);
    expect(br.x).toBeCloseTo(tr.x, 2);
    expect(br.y).toBeCloseTo(bl.y, 2);
    for (const { v, l } of cells) {
      expect(l.x).toBeCloseTo(v.x, 2);
      expect(l.y).toBeGreaterThanOrEqual(v.y + v.h - 0.001);
    }
  });
});

describe("#695 (b) KPI 4 つのスライドで値が 40pt 以上・太字・emphasis 色", () => {
  it("Pitch × manuscript-05 の 9 枚目", async () => {
    await expectEmphasizedValues(readFileSync(DECK, "utf8"), PITCH_PRESET, ["15 分 → 2 分", "月 40% 減", "3 週 → 2 週", "12 カ月"], 9);
  });
  it("Pitch × manuscript-07 の 8 枚目（KPI 3 つ・#719 以降は KPI.3Value.Equal）", async () => {
    await expectEmphasizedValues(readFileSync(CAMPAIGN_DECK, "utf8"), PITCH_PRESET, ["1.2 万", "3,000", "30"], 8, "KPI.3Value.Equal");
  });
  it("技術報告プリセット（全レイアウト）の KPI 4 つ", async () => {
    await expectEmphasizedValues(KPI4, REPORT_PRESET, ["4.2 億円", "−18%", "3 週 → 2 週", "12 カ月"]);
  });
});
