/**
 * apply-template-augment.test.ts — #568 段 2: 「テンプレを強化」の適用経路（apply-template.ts）。
 *
 * - 合成 bytes を faithful Re-make と同じ形で TemplateData として適用し、登録用 bytes と追加レイアウト名を返す。
 * - 足すものが無い／元にできない → 適用せず理由を返す（never-silent・テンプレは変えない）。
 * - 確認文（describeAugmentPlan）は何を・何を元に・文字サイズがどう変わるかを書く。
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import i18n from "../src/i18n";
import { applyTemplateBytesAsAugmented, describeAugmentPlan } from "../src/components/apply-template";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { planAugmentation } from "../src/engine/layout-augment-plan";

const DIR = resolve(__dirname, "fixtures/templates");
const bytes = (f: string) => new Uint8Array(readFileSync(resolve(DIR, f)));
const setters = () => ({ setTemplateData: vi.fn(), setTemplateName: vi.fn(), setParseError: vi.fn() });

describe("applyTemplateBytesAsAugmented", () => {
  it("技術報告: applies the augmented template, returns its bytes + the added layout", async () => {
    await i18n.changeLanguage("ja");
    const s = setters();
    const r = await applyTemplateBytesAsAugmented(bytes("技術報告_スタンダード水色_全レイアウト見本.pptx"), "技術報告", s);
    expect(r.ok).toBe(true);
    expect(r.augmentedBytes).toBeInstanceOf(Uint8Array);
    expect(r.summary?.added).toEqual(["02_本文（1カラム） +3Body"]);
    expect(s.setTemplateData).toHaveBeenCalledOnce();
    expect(s.setTemplateData.mock.calls[0][0].layouts.some((l: { name: string }) => l.name === "02_本文（1カラム） +3Body")).toBe(true);
    expect(s.setTemplateName).toHaveBeenCalledWith("技術報告（強化）");
    expect(s.setParseError).not.toHaveBeenCalled();
  });

  it("Midnight (nothing missing) / Dirty_AllBody (no base): not applied, reason returned, template untouched", async () => {
    for (const f of ["Midnight_Executive_30_TemplateOnly.pptx", "Dirty_AllBody_TemplateOnly.pptx"]) {
      const s = setters();
      const r = await applyTemplateBytesAsAugmented(bytes(f), f, s);
      expect(r.ok).toBe(false);
      expect(r.reason, f).toBeTruthy();
      expect(s.setTemplateData).not.toHaveBeenCalled();
    }
  });
});

describe("describeAugmentPlan", () => {
  it("names what is added, the base layout and the size change", async () => {
    await i18n.changeLanguage("ja");
    const tpl = await loadTemplate(bytes("技術報告_スタンダード水色_全レイアウト見本.pptx"));
    const text = describeAugmentPlan(planAugmentation(tpl, buildCatalog(tpl)));
    expect(text).toContain("3 列");
    expect(text).toContain("02_本文（1カラム）");
    expect(text).toContain("16→12pt");
    expect(text).toContain("強化しますか");
  });
});
