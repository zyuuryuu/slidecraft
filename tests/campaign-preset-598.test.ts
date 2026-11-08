/**
 * campaign-preset-598.test.ts — #598（#580 段 3）: マーケ プリセット「Campaign」＋画像構造。
 *
 *  (a) プリセット表: 配色（オフホワイトの canvas・低彩度の accent 1 色）・書体（見出しは明朝／セリフ・本文は
 *      ゴシック）・余白（左右 1.2in 以上）・ヘッダ帯なし（flatContent）・レイアウトの部分集合。画像構造の
 *      幾何（全面画像の枠がスライド全面・左キャプション｜右画像が重ならない・並置 2 枚／2×2 グリッドの
 *      picture 枠）・色面の章扉（背景＝accent）。生成テンプレは health ok・全レイアウトで全単射。
 *  (b) 出荷物とプリセット表の一致（R8）: 出荷 TemplateOnly は writePresetTemplate(CAMPAIGN_PRESET) と part 単位で同一・
 *      PRESET_ARTIFACTS が出荷先を持つ・BUILTIN_MASTERS に登録（既定は技術報告のまま）・CREDITS に記載。
 *  (c) 受け入れ: samples/manuscript-07-campaign.md（#580 目標デッキ B をマーケ寄りに書き直した 10 枚）を Campaign で
 *      取り込むと 10 枚のまま・消失系 0・各構造が意図のレイアウトと枠に入る（画像は #392 の figures と段 2 の配置
 *      figureRegions の 1 経路で解決）。
 *  (d) 選択の規則（slide-role-regions）: 画像だけのスライド（本文なし・画像 2 枚以上）→ 枠の数が一致する Gallery、
 *      本文なしの behind 画像 → Image.FullBleed。該当レイアウトの無いテンプレでは従来の選択のまま（退化）。
 *  (e) golden: 全レイアウト見本 fixture は生成スクリプトの出力と part 単位で同一。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import { BUILTIN_LAYOUTS } from "../src/engine/template-layout-library";
import { PRESET_LAYOUTS } from "../src/engine/template-layout-library-style";
import { CAMPAIGN_PRESET, writePresetTemplate, presetToSpec, PRESET_LIBRARY } from "../src/engine/template-presets";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, assessTemplateHealth, placeholderRole } from "../src/engine/template-catalog";
import { bindContentByRole, buildFieldMap } from "../src/engine/placeholder-binding";
import { slideBindingPlan } from "../src/engine/group-binding";
import { figureRegions, imagePlaceholder, imageRect, visualCollisions } from "../src/engine/visual-placement";
import { slideRoleRegions } from "../src/engine/slide-role-regions";
import { parseMd } from "../src/engine/md-parser";
import { BUILTIN_MASTERS, BUILTIN_MASTER } from "../src/components/useMasterRegistry";
import * as S from "../src/mcp/session";
import { LOSS_RULES, measureTemplate } from "../scripts/style-metrics";
import { PRESET_ARTIFACTS, buildTemplateOnly, buildShowcase } from "../scripts/gen-preset-templates";
import type { SlideIR, PlaceholderContent } from "../src/engine/slide-schema";

const ROOT = resolve(__dirname, "..");
const SHIPPED = resolve(ROOT, "public/templates/slide/マーケ_Campaign_TemplateOnly.pptx");
const SHOWCASE = resolve(ROOT, "tests/fixtures/templates/マーケ_Campaign_全レイアウト見本.pptx");
const DECK = resolve(ROOT, "samples/manuscript-07-campaign.md");
const PITCH = resolve(ROOT, "public/templates/slide/セールスピッチ_Pitch_TemplateOnly.pptx");

const CAMPAIGN_LAYOUTS = [
  "Title.1Title.Single",
  "Statement.1Message.Single",
  "Content.1Body.Single",
  "Column.2Body.Equal",
  "Image.FullBleed+1Caption",
  "Media.1Caption+1Image",
  "Gallery.2Image.Equal",
  "Gallery.4Image.Grid",
  "KPI.3Value.Equal",
  "Process.3Step.Sequential",
  "Section.1Title.ColorField",
  "SectionNav.1TitleList.Single",
  "Closing.1Notes.Bottom",
];

/** 全パートの名前＋内容（zip のエントリ日時は含めない）。 */
async function parts(bytes: Uint8Array): Promise<Record<string, string>> {
  const z = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  for (const n of Object.keys(z.files).sort()) {
    if (z.files[n].dir) continue;
    out[n] = createHash("sha256").update(await z.files[n].async("uint8array")).digest("hex");
  }
  return out;
}
const text = (c: PlaceholderContent | undefined) => c?.paragraphs.map((p) => p.segments.map((s) => s.text).join("")).join("\n");
const rgb = (hex: string) => [16, 8, 0].map((sh) => ((parseInt(hex, 16) >> sh) & 255) / 255);
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
/** HSL の彩度（0〜1）。 */
const saturation = (hex: string) => {
  const c = rgb(hex);
  const max = Math.max(...c), min = Math.min(...c), l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
};
const pics = (tpl: TemplateData, name: string) =>
  tpl.layouts.find((l) => l.name === name)!.placeholders.filter((p) => placeholderRole(p) === "picture").map((p) => p.style);
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6;

let generated: Uint8Array;
let tpl: TemplateData;
beforeAll(async () => {
  generated = await writePresetTemplate(CAMPAIGN_PRESET);
  tpl = await loadTemplate(generated);
});

describe("(a) CAMPAIGN_PRESET — プリセット表", () => {
  it("配色: オフホワイトの canvas・低彩度の accent 1 色・本文はグレー・文字は地に対して読める", () => {
    const p = CAMPAIGN_PRESET.palette;
    expect(lum(p.canvas)).toBeGreaterThan(0.8); // オフホワイト（白そのものではない）
    expect(p.canvas).not.toBe("FFFFFF");
    expect(saturation(p.accent)).toBeLessThan(0.3); // 低彩度
    expect(saturation(p.bodyText)).toBeLessThan(0.1); // グレー
    expect(contrast(p.canvas, p.bodyText)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.background, p.titleText)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.accent, p.canvas)).toBeGreaterThanOrEqual(4.5); // 色面の章扉（accent 地に canvas 色の文字）
  });

  it("書体: 見出しは明朝／セリフ・本文はゴシック／サンセリフ・余白: 左右 1.2in 以上・ヘッダ帯なし", () => {
    expect(CAMPAIGN_PRESET.fonts.majorEa).toMatch(/Mincho|明朝/);
    expect(CAMPAIGN_PRESET.fonts.major).toMatch(/Georgia|Serif|Mincho|明朝/);
    expect(CAMPAIGN_PRESET.fonts.minorEa).toMatch(/Gothic|ゴシック/);
    expect(CAMPAIGN_PRESET.density.marginIn).toBeGreaterThanOrEqual(1.2);
    expect(CAMPAIGN_PRESET.flatContent).toBe(true);
    expect(presetToSpec(CAMPAIGN_PRESET).flatContent).toBe(true);
  });

  it("レイアウトはマーケ用の部分集合（この順）で、生成テンプレは health ok", () => {
    expect(CAMPAIGN_PRESET.layouts).toEqual(CAMPAIGN_LAYOUTS);
    expect(tpl.layouts.map((l) => l.name)).toEqual(CAMPAIGN_LAYOUTS);
    expect(assessTemplateHealth(buildCatalog(tpl)).status).toBe("ok");
  });

  it("全面画像: picture 枠がスライド全面（余白の縮小を受けない）・キャプションは左下の小さな 1 行", () => {
    const [full] = pics(tpl, "Image.FullBleed+1Caption");
    expect(full.x).toBeCloseTo(0, 2);
    expect(full.y).toBeCloseTo(0, 2);
    expect(full.w).toBeCloseTo(13.333, 2);
    expect(full.h).toBeCloseTo(7.5, 2);
    const layout = tpl.layouts.find((l) => l.name === "Image.FullBleed+1Caption")!;
    const caption = layout.placeholders.find((p) => placeholderRole(p) === "title")!.style;
    expect(caption.x).toBeLessThan(13.333 / 2);
    expect(caption.y).toBeGreaterThan(7.5 * 0.8);
    expect(caption.fontSize).toBeLessThanOrEqual(16);
  });

  it("左キャプション｜右画像・並置 2 枚・2×2 グリッドの picture 枠は互いに重ならず、余白 1.2in の内側", () => {
    const media = tpl.layouts.find((l) => l.name === "Media.1Caption+1Image")!;
    const cap = media.placeholders.find((p) => placeholderRole(p) === "body")!.style;
    const [img] = pics(tpl, "Media.1Caption+1Image");
    expect(cap.x + cap.w).toBeLessThanOrEqual(img.x);
    expect(img.w).toBeGreaterThan(cap.w * 2); // 画像が主役
    const two = pics(tpl, "Gallery.2Image.Equal");
    const four = pics(tpl, "Gallery.4Image.Grid");
    expect(two).toHaveLength(2);
    expect(four).toHaveLength(4);
    for (const set of [two, four, [cap, img]]) {
      for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) expect(overlap(set[i], set[j])).toBe(false);
      for (const b of set) {
        expect(b.x).toBeGreaterThanOrEqual(1.2 - 1e-6);
        expect(b.x + b.w).toBeLessThanOrEqual(13.333 - 1.2 + 1e-3);
      }
    }
    // 2×2: 2 行 × 2 列（idx 順＝左上・右上・左下・右下）
    expect(four[0].y).toBeCloseTo(four[1].y, 3);
    expect(four[2].y).toBeCloseTo(four[3].y, 3);
    expect(four[0].x).toBeCloseTo(four[2].x, 3);
    expect(four[2].y).toBeGreaterThan(four[0].y + four[0].h - 1e-6);
  });

  it("色面の章扉: 背景が accent（他のレイアウトは canvas と同じオフホワイト）", async () => {
    const z = await JSZip.loadAsync(generated);
    const i = CAMPAIGN_LAYOUTS.indexOf("Section.1Title.ColorField") + 1;
    const xml = await z.file(`ppt/slideLayouts/slideLayout${i}.xml`)!.async("string");
    const bg = (x: string) => /<p:bg><p:bgPr><a:solidFill><a:srgbClr val="([0-9A-F]{6})"\/>/.exec(x)?.[1];
    expect(bg(xml)).toBe(CAMPAIGN_PRESET.palette.accent);
    const title = await z.file("ppt/slideLayouts/slideLayout1.xml")!.async("string");
    expect(bg(title)).toBe(CAMPAIGN_PRESET.palette.canvas);
  });

  it("ヘッダ帯なし: light 系レイアウトに全幅の帯（Deco）を描かない", async () => {
    const z = await JSZip.loadAsync(generated);
    const i = CAMPAIGN_LAYOUTS.indexOf("Content.1Body.Single") + 1;
    const xml = await z.file(`ppt/slideLayouts/slideLayout${i}.xml`)!.async("string");
    expect(xml).not.toMatch(/name="Deco\d+"/);
  });

  it("編集フィールドの写像は全レイアウトで全単射（単射・往復・単独入力）", () => {
    for (const layout of tpl.layouts) {
      const map = buildFieldMap({ layout: layout.name, placeholders: [] }, layout.placeholders);
      expect(new Set(map.map((m) => m.contentIdx)).size, layout.name).toBe(map.length);
      const probe: SlideIR = { layout: layout.name, placeholders: map.map((m, i) => ({ idx: m.contentIdx, paragraphs: [{ segments: [{ text: ` ${i}` }] }] })) };
      const bound = bindContentByRole(probe, layout.placeholders);
      map.forEach((m, i) => expect(text(bound.get(m.phIdx)), `${layout.name} ${m.phIdx}`).toBe(` ${i}`));
      for (const slot of map) {
        const solo: SlideIR = { layout: layout.name, placeholders: [{ idx: slot.contentIdx, paragraphs: [{ segments: [{ text: "S" }] }] }] };
        const b = bindContentByRole(solo, layout.placeholders);
        expect(text(b.get(slot.phIdx)), `${layout.name} ${slot.phIdx}`).toBe("S");
      }
    }
  });
});

describe("(b) 出荷物とプリセット表の一致（R8）", () => {
  it("出荷 TemplateOnly は writePresetTemplate(CAMPAIGN_PRESET) と part 単位で同一", async () => {
    expect(await parts(new Uint8Array(readFileSync(SHIPPED)))).toEqual(await parts(generated));
  });

  it("生成スクリプトの成果物表は Campaign の出荷先を持ち、その出力も同一（日付を固定した再生成で決定論的）", async () => {
    const a = PRESET_ARTIFACTS.find((x) => x.preset === CAMPAIGN_PRESET)!;
    expect(a.templateOnly).toBe("public/templates/slide/マーケ_Campaign_TemplateOnly.pptx");
    const once = await buildTemplateOnly(a);
    expect(await parts(once)).toEqual(await parts(generated));
    expect(Buffer.from(await buildTemplateOnly(a)).equals(Buffer.from(once))).toBe(true);
  });

  it("BUILTIN_MASTERS に登録・既定（先頭）は技術報告のまま・CREDITS に記載", () => {
    expect(BUILTIN_MASTERS[0].id).toBe("builtin-gijutsu");
    expect(BUILTIN_MASTERS).toContainEqual({ id: "builtin-campaign", name: "マーケ Campaign", url: "/templates/slide/マーケ_Campaign_TemplateOnly.pptx" });
    expect(BUILTIN_MASTER.id).toBe("builtin-gijutsu");
    expect(readFileSync(resolve(ROOT, "public/templates/slide/CREDITS.md"), "utf8")).toContain("マーケ_Campaign_TemplateOnly.pptx");
  });
});

describe("(c) 受け入れ: マーケ 10 枚を Campaign で取り込む", () => {
  const md = () => readFileSync(DECK, "utf8");
  const EXPECTED = [
    "Title.1Title.Single", // タイポ中心の表紙
    "Statement.1Message.Single", // <!-- statement -->
    "Image.FullBleed+1Caption", // 全面画像＋左下キャプション（behind 画像・本文なし）
    "Section.1Title.ColorField", // 色面の章扉
    "Media.1Caption+1Image", // 左キャプション｜右画像
    "Gallery.4Image.Grid", // 連作 2×2
    "Gallery.2Image.Equal", // 対作品（並置 2 枚）
    "KPI.3Value.Equal", // キャンペーン KPI
    "Process.3Step.Sequential", // 体験の流れ
    "Closing.1Notes.Bottom", // 下寄せ小文字の締め
  ];

  it("10 枚のまま（自動分割 0）・get_deck_issues の消失系 0・画像の重なり 0", async () => {
    const s = S.createSession(null);
    await S.newProject(s, generated, md());
    expect(s.deck!.slides).toHaveLength(10);
    const issues = S.getDiagnostics(s).issues;
    expect(issues.filter((d) => d.id && LOSS_RULES.includes(d.id))).toEqual([]);
    expect(issues.filter((d) => d.id === "visual-collision" || d.id === "missing-column-layout")).toEqual([]);
  });

  it("各スライドが意図のレイアウトに入る", async () => {
    const m = await measureTemplate(md(), "campaign", generated);
    expect(m.slides).toBe(10);
    expect(m.autoSplit).toBe(0);
    expect(m.lossIssues).toBe(0);
    expect(m.perSlide.map((p) => p.layout)).toEqual(EXPECTED);
  });

  it("中身が意図の枠に入る: 画像は各 picture 枠へ 1 枚ずつ・全面画像はスライド全面・キャプションは本文枠", async () => {
    const s = S.createSession(null);
    await S.newProject(s, generated, md());
    const catalog = buildCatalog(tpl);
    const slides = s.deck!.slides;
    const layoutAt = (i: number) => tpl.layouts.find((l) => l.name === autoSelectLayout(slides[i], i, slides.length, catalog))!;
    const bound = (i: number, phName: string) => {
      const layout = layoutAt(i);
      const idx = layout.placeholders.find((p) => p.name === phName)!.idx;
      return text(slideBindingPlan(slides[i], layout).assignments.find((a) => a.placeholder.idx === idx)?.content.content);
    };
    // 全面画像: behind 画像が全面の picture 枠の箱で描かれ、作品名は左下のキャプション（タイトル枠）
    const fb = layoutAt(2);
    expect(slides[2].image?.behind).toBe(true);
    expect(imageRect(slides[2].image!, imagePlaceholder(fb.placeholders, slides[2].image!.placeholderIdx))).toEqual({ x: 0, y: 0, w: expect.closeTo(13.333, 2), h: expect.closeTo(7.5, 2) });
    expect(bound(2, "Caption.BottomLeft")).toBe("夕凪 — 青木 葵, 2024");
    // 色面の章扉
    expect(bound(3, "Title.Center")).toBe("I. 水辺の光");
    // 左キャプション｜右画像: 本文はキャプション枠、画像は picture 枠（本文を隠さない）
    expect(bound(4, "Caption.Left")).toContain("河口で潮が入れ替わる");
    const media = figureRegions(slides[4], layoutAt(4).placeholders);
    expect(media.map((r) => r.ph && placeholderRole(r.ph))).toEqual(["picture"]);
    // 2×2 と並置 2 枚: 画像 N 枚が N 個の picture 枠へ出現順に 1 枚ずつ（figureRegions = 出力と同じ解決）
    for (const [i, n] of [[5, 4], [6, 2]] as const) {
      const regions = figureRegions(slides[i], layoutAt(i).placeholders);
      expect(regions, `slide ${i + 1}`).toHaveLength(n);
      expect(regions.map((r) => r.figure.kind)).toEqual(Array(n).fill("image"));
      expect(regions.map((r) => r.ph?.idx)).toEqual(pics(tpl, layoutAt(i).name).map((_b, k) => layoutAt(i).placeholders.filter((p) => placeholderRole(p) === "picture")[k].idx));
      expect(visualCollisions(slides[i], layoutAt(i).placeholders)).toEqual([]);
    }
    expect(bound(9, "Notes.Bottom")).toContain("hello@example.com");
  });

  it("書き出した PPTX: グリッドは画像 4 枚・並置は 2 枚・全面画像は 1 枚が描かれる", async () => {
    const s = S.createSession(null);
    await S.newProject(s, generated, md());
    const z = await JSZip.loadAsync((await S.exportPptxBytes(s)).bytes);
    const picsIn = async (n: number) => ((await z.file(`ppt/slides/slide${n}.xml`)!.async("string")).match(/<p:pic>/g) ?? []).length;
    expect(await picsIn(3)).toBe(1);
    expect(await picsIn(5)).toBe(1);
    expect(await picsIn(6)).toBe(4);
    expect(await picsIn(7)).toBe(2);
  });

  it("文字量はマーケの目標帯（1 枚 25 字以下）に入る", async () => {
    const m = await measureTemplate(md(), "campaign", generated);
    expect(m.charsPerSlide).toBeLessThanOrEqual(25);
  });
});

describe("(d) 選択の規則と退化（既存テンプレの選択は不変）", () => {
  const slide = (body: string) => parseMd(`# 表紙\n\n---\n\n${body}\n\n---\n\n# 締め\n`).slides[1];
  const IMG = "![a](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC)";

  it("画像だけ（本文なし・2 枚以上）→ visual: gallery（枚数）／本文なしの behind 画像 → visual: image／本文があれば無し", () => {
    expect(slideRoleRegions(slide(`# G\n\n${IMG}\n${IMG}`), 1, 3).visual).toEqual({ role: "gallery", count: 2 });
    expect(slideRoleRegions(slide(`# G\n\n${IMG}\n${IMG}\n${IMG}\n${IMG}`), 1, 3).visual).toEqual({ role: "gallery", count: 4 });
    expect(slideRoleRegions(slide(`# F\n\n${IMG}{behind=1}`), 1, 3).visual).toEqual({ role: "image", count: 1 });
    expect(slideRoleRegions(slide(`# M\n\n本文\n\n${IMG}\n${IMG}`), 1, 3).visual).toBeUndefined();
    expect(slideRoleRegions(slide(`# M\n\n本文\n\n${IMG}{behind=1}`), 1, 3).visual).toBeUndefined();
    expect(slideRoleRegions(slide(`# M\n\n${IMG}`), 1, 3).visual).toBeUndefined(); // 1 枚は Media（Pitch の導入実績と同じ）
  });

  it("枠の数が一致する Gallery が無ければ従来の選択（3 枚は Campaign でも Gallery に入らない）", () => {
    const catalog = buildCatalog(tpl);
    const three = slide(`# G\n\n${IMG}\n${IMG}\n${IMG}`);
    expect(autoSelectLayout(three, 1, 3, catalog)).not.toMatch(/^Gallery\./);
  });

  it("Gallery／Image レイアウトの無いテンプレ（Pitch）では、このデッキの選択は従来どおり", async () => {
    const m = await measureTemplate(readFileSync(DECK, "utf8"), "pitch", new Uint8Array(readFileSync(PITCH)));
    // #598 以前の main で実測した選択（全面画像は Media・画像だけのスライドは列レイアウト）
    expect(m.perSlide.map((p) => p.layout)).toEqual([
      "Title.1Title.Single",
      "Statement.1Message.Single",
      "Media.1Body+1Image",
      "Content.1Body.Single",
      "Media.1Body+1Image",
      "Column.3Body.Equal",
      "Column.3Body.Equal",
      "KPI.4Value.Grid",
      "Process.4Step.Sequential",
      "Closing.1CTA+1Contact",
    ]);
  });
});

describe("(e) golden: 全レイアウト見本 fixture と既存出力の不変", () => {
  it("見本は全レイアウトを 1 枚ずつ（プリセットの順）使い、生成スクリプトの出力と part 単位で同一", async () => {
    const a = PRESET_ARTIFACTS.find((x) => x.preset === CAMPAIGN_PRESET)!;
    expect(a.showcase).toBe("tests/fixtures/templates/マーケ_Campaign_全レイアウト見本.pptx");
    const fixture = new Uint8Array(readFileSync(SHOWCASE));
    expect(await parts(fixture)).toEqual(await parts(await buildShowcase(a)));
    const deck = parseMd(readFileSync(resolve(ROOT, a.showcaseMarkdown), "utf8"));
    const catalog = buildCatalog(tpl);
    expect(deck.slides.map((sl, i) => autoSelectLayout(sl, i, deck.slides.length, catalog))).toEqual(CAMPAIGN_LAYOUTS);
    expect((await loadTemplate(fixture)).layouts.map((l) => l.name)).toEqual(CAMPAIGN_LAYOUTS);
  });

  it("スタイル専用 LayoutDef は BUILTIN_LAYOUTS に入らない（既存 TemplateSpec の出力は変わらない）", () => {
    const builtin = new Set(BUILTIN_LAYOUTS.map((d) => d.name));
    for (const d of PRESET_LAYOUTS) expect(builtin.has(d.name)).toBe(false);
    for (const name of CAMPAIGN_LAYOUTS) expect(PRESET_LIBRARY.some((d) => d.name === name), name).toBe(true);
  });
});
