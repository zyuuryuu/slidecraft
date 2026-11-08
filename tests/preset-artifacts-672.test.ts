/**
 * preset-artifacts-672.test.ts — #672（PR #668 Campaign のレビュー nit 3 件）。
 *
 *  1. `Caption.BottomLeft`（全面画像レイアウトの左下キャプション）は画像なしでも読める: レイアウトの地の色と
 *     文字色のコントラストが 4.5:1 以上（WCAG 2.2 1.4.3・#649 の計測と同じ相対輝度の式）。画像は `{behind=1}`
 *     の背景画像としてスライドの最背面に描かれ、地の色はその下に隠れる＝画像ありの見た目は変わらない。
 *  2. suggestLayouts（編集画面の「Auto → X、他の候補」）: 画像だけのスライドでは、画像が 1 枚も落ちない
 *     Gallery.*（picture 枠＝画像を入れる枠が枚数以上）が自動選択の直後に並ぶ。枠数の判定は pickRoleLayout と
 *     同じ 1 関数（R8）。
 *  3. PRESET_ARTIFACTS（scripts/gen-preset-templates.ts の成果物表）1 表で Pitch／Executive／Campaign の
 *     出荷テンプレと全レイアウト見本がすべて生成され、commit 済みのファイルと 1 byte も違わない。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { CAMPAIGN_PRESET, EXECUTIVE_PRESET, PITCH_PRESET, writePresetTemplate } from "../src/engine/template-presets";
import { loadTemplate, autoSelectLayout, suggestLayouts, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, placeholderRole, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { PRESET_ARTIFACTS, buildTemplateOnly, buildShowcase } from "../scripts/gen-preset-templates";

const ROOT = resolve(__dirname, "..");
const rgb = (hex: string) => [16, 8, 0].map((sh) => ((parseInt(hex, 16) >> sh) & 255) / 255);
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

let tpl: TemplateData;
let catalog: LayoutCatalog;
beforeAll(async () => {
  tpl = await loadTemplate(await writePresetTemplate(CAMPAIGN_PRESET));
  catalog = buildCatalog(tpl);
});

describe("1. Caption.BottomLeft は画像なしでも読める", () => {
  it("全面画像レイアウトの地の色とキャプションの文字色のコントラストが 4.5:1 以上", () => {
    const layout = tpl.layouts.find((l) => l.name === "Image.FullBleed+1Caption")!;
    const caption = layout.placeholders.find((p) => p.name === "Caption.BottomLeft")!;
    expect(layout.background).toBeDefined();
    expect(contrast(layout.background!, caption.style.fontColor)).toBeGreaterThanOrEqual(4.5);
  });

  it("出荷テンプレと全レイアウト見本（commit 済み）でも同じ（見本は画像なしで全面画像レイアウトを描く）", async () => {
    const a = PRESET_ARTIFACTS.find((x) => x.preset === CAMPAIGN_PRESET)!;
    for (const file of [a.templateOnly, a.showcase]) {
      const t = await loadTemplate(new Uint8Array(readFileSync(resolve(ROOT, file))));
      const layout = t.layouts.find((l) => l.name === "Image.FullBleed+1Caption")!;
      const caption = layout.placeholders.find((p) => p.name === "Caption.BottomLeft")!;
      expect(contrast(layout.background!, caption.style.fontColor), file).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("2. suggestLayouts: 画像だけのスライドの候補上位に Gallery.*", () => {
  const IMG = "![a](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC)";
  const slide = (n: number) => parseMd(`# 表紙\n\n---\n\n# G\n\n${Array(n).fill(IMG).join("\n")}\n\n---\n\n# 締め\n`).slides[1];
  const frames = (name: string) =>
    tpl.layouts.find((l) => l.name === name)!.placeholders.filter((p) => placeholderRole(p) === "picture").length;

  it("2 枚: 先頭は自動選択（Gallery.2）・2 位は枠に余裕のある Gallery.4", () => {
    const s = slide(2);
    const got = suggestLayouts(s, 1, 3, catalog);
    expect(got[0]).toBe(autoSelectLayout({ ...s, layout: "auto" }, 1, 3, catalog));
    expect(got.slice(0, 2)).toEqual(["Gallery.2Image.Equal", "Gallery.4Image.Grid"]);
  });

  it("3 枚（ちょうどの Gallery が無い）: 枠が足りる Gallery.4 が 2 位・枠が足りない Gallery.2 は上位に来ない", () => {
    const s = slide(3);
    const got = suggestLayouts(s, 1, 3, catalog);
    expect(got[0]).not.toMatch(/^Gallery\./); // 自動選択は従来どおり（#598 (d)）
    expect(got[1]).toBe("Gallery.4Image.Grid");
    expect(got.indexOf("Gallery.2Image.Equal")).toBeGreaterThan(got.indexOf("Gallery.4Image.Grid"));
    expect(frames("Gallery.2Image.Equal")).toBeLessThan(3);
  });

  it("4 枚: 先頭は Gallery.4・枠が足りない Gallery.2 は 2 位に来ない", () => {
    const got = suggestLayouts(slide(4), 1, 3, catalog);
    expect(got[0]).toBe("Gallery.4Image.Grid");
    expect(got[1]).not.toBe("Gallery.2Image.Equal");
  });

  it("画像の無いスライドの候補は Gallery を上位に出さない（従来どおり）", () => {
    const s = parseMd("# 表紙\n\n---\n\n# 本文\n\n- 一\n- 二\n\n---\n\n# 締め\n").slides[1];
    expect(suggestLayouts(s, 1, 3, catalog).some((n) => n.startsWith("Gallery."))).toBe(false);
  });
});

describe("3. PRESET_ARTIFACTS 1 表で全プリセットの出荷物を生成", () => {
  it("Pitch／Executive／Campaign を 1 回ずつ持つ", () => {
    expect(PRESET_ARTIFACTS.map((a) => a.preset)).toEqual([PITCH_PRESET, EXECUTIVE_PRESET, CAMPAIGN_PRESET]);
    const exec = PRESET_ARTIFACTS.find((a) => a.preset === EXECUTIVE_PRESET)!;
    expect(exec.templateOnly).toBe("public/templates/slide/エグゼクティブ_Executive_TemplateOnly.pptx");
    expect(exec.showcase).toBe("tests/fixtures/templates/エグゼクティブ_Executive_全レイアウト見本.pptx");
  });

  for (const a of PRESET_ARTIFACTS) {
    it(`${a.preset.name}: 再生成した出荷テンプレと見本が commit 済みのファイルと byte-identical`, async () => {
      const t = await buildTemplateOnly(a);
      expect(Buffer.from(t).equals(readFileSync(resolve(ROOT, a.templateOnly))), a.templateOnly).toBe(true);
      expect(Buffer.from(await buildShowcase(a, t)).equals(readFileSync(resolve(ROOT, a.showcase))), a.showcase).toBe(true);
    }, 30_000);
  }
});
