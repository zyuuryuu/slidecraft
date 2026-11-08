/**
 * apply-template-augment-structures.test.ts — #568 段 3: GUI「テンプレを強化」は無い構造（N 列・比較・カード 3・
 * KPI 3/4）を全部足す。確認文には足すもの（文字サイズ付き）と、既にあるので足さないものを一覧で出す（never-silent）。
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import i18n from "../src/i18n";
import { applyTemplateBytesAsAugmented, describeAugmentPlan } from "../src/components/apply-template";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { planAugmentation } from "../src/engine/layout-augment-plan";
import { ALL_AUGMENT_STRUCTURES } from "../src/engine/layout-augment-structures";

const DIR = resolve(__dirname, "fixtures/templates");
const bytes = (f: string) => new Uint8Array(readFileSync(resolve(DIR, f)));
const TECH = "技術報告_スタンダード水色_全レイアウト見本.pptx";

describe("describeAugmentPlan — all structures", () => {
  it("技術報告 (ja): lists 3 列 and KPI 4 個 with sizes (KPI heading pt too) and the structures not added because present", async () => {
    await i18n.changeLanguage("ja");
    const tpl = await loadTemplate(bytes(TECH));
    const plan = planAugmentation(tpl, buildCatalog(tpl), { structures: ALL_AUGMENT_STRUCTURES });
    const kpi = plan.add.find((a) => a.structure === "kpi-4")!;
    const text = describeAugmentPlan(plan);
    expect(text).toContain("3 列・KPI 4 個 のレイアウト");
    expect(text).toContain("3 列 16→12pt");
    expect(text).toContain(`KPI 4 個 本文 16→12pt・見出し ${kpi.group!.headSize}pt`);
    expect(text).toContain("既にあるため追加しないもの: 2 列・比較（左右 2 案）・カード 3 枚・KPI 3 個");
    expect(text).toContain("強化しますか");
  });

  it("en: structure labels are translated", async () => {
    await i18n.changeLanguage("en");
    const tpl = await loadTemplate(bytes("Dirty_Grouped_TemplateOnly.pptx"));
    const text = describeAugmentPlan(planAugmentation(tpl, buildCatalog(tpl), { structures: ALL_AUGMENT_STRUCTURES }));
    for (const l of ["2-column", "3-column", "comparison (2 options)", "3 cards", "3 KPIs", "4 KPIs"]) expect(text).toContain(l);
    expect(text).not.toContain("Not added");
    await i18n.changeLanguage("ja");
  });
});

describe("applyTemplateBytesAsAugmented — structures option", () => {
  it("技術報告: applies the confirmed structures (3 列 + KPI 4 個) and registers both names", async () => {
    await i18n.changeLanguage("ja");
    const s = { setTemplateData: vi.fn(), setTemplateName: vi.fn(), setParseError: vi.fn() };
    const r = await applyTemplateBytesAsAugmented(bytes(TECH), "技術報告", s, { structures: ["columns-3", "kpi-4"] });
    expect(r.ok).toBe(true);
    expect(r.summary?.added).toEqual(["02_本文（1カラム） +3Body", "02_本文（1カラム） +4KPI"]);
    expect(s.setTemplateName).toHaveBeenCalledWith("技術報告（強化）");
  });
});
