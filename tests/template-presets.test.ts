/**
 * template-presets.test.ts — #594（#580 段 2-b）: writer の拡張 3 点。
 *   (a) `pic` 型の枠: LayoutPhDef.type="pic" → `<p:ph type="pic">`。loader が picture 役 1 つとして読み、
 *       画像付き md がその枠に束縛される。編集フィールドの全単射（field-map-bijection と同じ検査）も保つ。
 *   (b) レイアウト別背景色: LayoutDef.bg → そのレイアウトの `<p:bg>`。loader の layout.background
 *       （プレビュー SlidePreview.tsx が読む値）に反映される。
 *   (c) プリセット表: 既存相当のプリセット（REPORT_PRESET）の出力は従来の TemplateSpec 出力と同一。
 *       既存 TemplateSpec（作成 UI 既定・flatContent・Re-make）の出力も変更前と同一（変更前に採取した指紋）。
 *   (d) #570 の adjustTemplate がプリセット出力にもそのまま掛かる。density.bodyPt は同じ変換経路で
 *       実現する（第 2 のサイズ規則を作らない・R8 の一致テスト）。
 * pic/bg を使う LayoutDef は検証用としてここに置く（内蔵語彙への追加は #595/#596/#598）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import { writeTemplate, MIDNIGHT_PALETTE, type TemplateSpec } from "../src/engine/template-writer";
import { BUILTIN_LAYOUTS, type LayoutDef } from "../src/engine/template-layout-library";
import {
  REPORT_PRESET,
  BASE_DENSITY,
  presetToSpec,
  presetRecipe,
  writePresetTemplate,
  withHorizontalMargin,
  type StylePreset,
} from "../src/engine/template-presets";
import { adjustTemplate } from "../src/engine/template-adjust";
import { loadTemplate, autoSelectLayout } from "../src/engine/template-loader";
import { buildCatalog, assessTemplateHealth, placeholderRole } from "../src/engine/template-catalog";
import { masterToTemplateSpec } from "../src/engine/master-remake";
import { bindContentByRole, buildFieldMap } from "../src/engine/placeholder-binding";
import { imagePlaceholder, drawnImage } from "../src/engine/visual-placement";
import { parseMd } from "../src/engine/md-parser";
import { generatePptx } from "../src/engine/placeholder-filler";
import type { SlideIR } from "../src/engine/slide-schema";

const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const EMU = (inches: number) => Math.round(inches * 914400);
const CANON = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

/** 中身の指紋: 全パートの名前＋内容（zip のエントリ日時は生成時刻で変わるので含めない）。 */
async function contentDigest(bytes: Uint8Array): Promise<string> {
  const z = await JSZip.loadAsync(bytes);
  const h = createHash("sha256");
  for (const n of Object.keys(z.files).sort()) {
    if (z.files[n].dir) continue;
    h.update(n + "\0");
    h.update(await z.files[n].async("uint8array"));
    h.update("\0");
  }
  return h.digest("hex");
}
const partOf = async (bytes: Uint8Array, path: string) => (await JSZip.loadAsync(bytes)).file(path)!.async("string");

const layoutsByName = (names: string[]) => names.map((n) => BUILTIN_LAYOUTS.find((d) => d.name === n)!);

// ── 検証用 LayoutDef（内蔵語彙ではない）──
// 左に本文・右に画像枠（velis の Picture Right と同じ型）。画像枠の idx は content 系 1〜9・META 10〜12・
// 見出し 15/16・sldNum 50 と衝突しない自由枠（Kicker の 40 と同じ考え方）。
// 注: 下端の薄い説明枠だけを持つ全面画像型は、現行カタログでは説明枠が date（下端の帯）・レイアウトが
// section と読まれる（本 PR で実測）。その型の役割判定は全面画像レイアウトを足す #598 の範囲。
const PIC_LAYOUT: LayoutDef = {
  name: "Test.1Body.Single+1Image",
  family: "light",
  placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "Image.Right", type: "pic", idx: 20, x: 5.6, y: 1.45, w: 6.9, h: 5.4, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Body.Left", type: "body", idx: 1, x: 0.8, y: 1.45, w: 4.4, h: 5.4, fontSize: 14, font: "minor", color: "bodyText", bold: false, align: "l" },
  ],
};
// 色面の章扉: dark 系だが背景は accent。
const BG_LAYOUT: LayoutDef = {
  name: "Test.Section.ColorField",
  family: "dark",
  bg: "accent",
  placeholders: [
    { name: "Title.Center", type: "body", idx: 15, x: 1.2, y: 2.5, w: 10.5, h: 1.5, fontSize: 40, font: "major", color: "titleText", bold: true, align: "l" },
  ],
};

const midnightSpec = (): TemplateSpec => ({ name: "Generated Midnight", fonts: { major: "Georgia", minor: "Calibri" }, palette: { ...MIDNIGHT_PALETTE } });

describe("(a) pic 型の枠", () => {
  const spec = (): TemplateSpec => ({ ...midnightSpec(), layouts: [...layoutsByName(["Title.1Title.Single", "Content.1Body.Single"]), PIC_LAYOUT] });

  it("<p:ph type=\"pic\" idx=…/> が書かれ、loader が picture 役 1 つとして読む（health は rejected でない）", async () => {
    const bytes = await writeTemplate(spec());
    expect(await partOf(bytes, "ppt/slideLayouts/slideLayout3.xml")).toContain(`<p:ph type="pic" idx="20"/>`);
    const tpl = await loadTemplate(bytes);
    const layout = tpl.layouts.find((l) => l.name === PIC_LAYOUT.name)!;
    const pics = layout.placeholders.filter((p) => placeholderRole(p) === "picture");
    expect(pics.map((p) => p.idx)).toEqual(["20"]);
    expect(assessTemplateHealth(buildCatalog(tpl)).status).not.toBe("rejected");
  });

  it("画像付き md は picture 枠のレイアウトが自動選択され、<p:pic> がその枠の幾何に収まる", async () => {
    const tpl = await loadTemplate(await writeTemplate(spec()));
    const catalog = buildCatalog(tpl);
    const deck = parseMd(`# 写真\n\n![pic](${IMG})`);
    const slide = deck.slides[0];
    expect(autoSelectLayout(slide, 1, 3, catalog)).toBe(PIC_LAYOUT.name);
    const layout = tpl.layouts.find((l) => l.name === PIC_LAYOUT.name)!;
    const frame = imagePlaceholder(layout.placeholders, slide.image!.placeholderIdx)!;
    expect(frame.idx).toBe("20");
    deck.template = undefined;
    const s1 = await partOf(await generatePptx(deck, tpl), "ppt/slides/slide1.xml");
    const m = s1.match(/name="Image"[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/);
    expect(m, "an Image <p:pic> with explicit xfrm must be present").toBeTruthy();
    const drawn = drawnImage(slide.image!, { x: frame.style.x, y: frame.style.y, w: frame.style.w, h: frame.style.h }).rect;
    expect(m!.slice(1).map(Number)).toEqual([EMU(drawn.x), EMU(drawn.y), EMU(drawn.w), EMU(drawn.h)]);
    expect(s1).toContain("写真");
  });

  it("編集フィールドの写像は全単射のまま（field-map-bijection と同じ単射・往復・単独入力の検査）", async () => {
    const tpl = await loadTemplate(await writeTemplate(spec()));
    const layout = tpl.layouts.find((l) => l.name === PIC_LAYOUT.name)!;
    const text = (c: { paragraphs: { segments: { text: string }[] }[] } | undefined) => c?.paragraphs[0]?.segments[0]?.text ?? "";
    const map = buildFieldMap({ layout: layout.name, placeholders: [] }, layout.placeholders);
    expect(map.length).toBeGreaterThan(0);
    expect(new Set(map.map((m) => m.contentIdx)).size).toBe(map.length);
    const probe: SlideIR = { layout: layout.name, placeholders: map.map((m, i) => ({ idx: m.contentIdx, paragraphs: [{ segments: [{ text: ` ${i}` }] }] })) };
    const bound = bindContentByRole(probe, layout.placeholders);
    map.forEach((m, i) => expect(text(bound.get(m.phIdx)), m.phIdx).toBe(` ${i}`));
    for (const slot of map) {
      const solo: SlideIR = { layout: layout.name, placeholders: [{ idx: slot.contentIdx, paragraphs: [{ segments: [{ text: "S" }] }] }] };
      const b = bindContentByRole(solo, layout.placeholders);
      expect(text(b.get(slot.phIdx))).toBe("S");
      for (const other of map) if (other.phIdx !== slot.phIdx) expect(text(b.get(other.phIdx))).not.toBe("S");
    }
  });
});

describe("(b) レイアウト別背景色 bg", () => {
  it("bg 付きレイアウトの <p:bg> は bg キーの色、loader の layout.background（プレビューが読む値）に反映", async () => {
    const palette = { ...MIDNIGHT_PALETTE, accent: "E4572E" };
    const bytes = await writeTemplate({ ...midnightSpec(), palette, layouts: [...layoutsByName(["Title.1Title.Single", "Content.1Body.Single"]), BG_LAYOUT] });
    expect(await partOf(bytes, "ppt/slideLayouts/slideLayout3.xml")).toContain(`<p:bg><p:bgPr><a:solidFill><a:srgbClr val="E4572E"/>`);
    const tpl = await loadTemplate(bytes);
    expect(tpl.layouts.find((l) => l.name === BG_LAYOUT.name)!.background?.toUpperCase()).toBe("E4572E");
    // bg を持たないレイアウトは family 由来のまま
    expect(tpl.layouts.find((l) => l.name === "Title.1Title.Single")!.background?.toUpperCase()).toBe(MIDNIGHT_PALETTE.background);
    expect(tpl.layouts.find((l) => l.name === "Content.1Body.Single")!.background?.toUpperCase()).toBe(MIDNIGHT_PALETTE.canvas);
  });
});

// 変更前（main ae067cc の writeTemplate）で採取した中身の指紋。既存 TemplateSpec 経路の出力不変を固定する。
// #593 で BUILTIN_LAYOUTS に Statement / Quote / Closing(CTA) の 3 LayoutDef が増えたので再固定（PR #607 マージ時）。
// 差分は slideLayout33〜35（＋その rels）・slideMaster1 の sldLayoutId 3 行・[Content_Types] の Override 3 行だけで、
// 既存 32 レイアウトの XML は part 単位で byte-identical（統括が main と部分ごとの sha256 を比較して確認）。
const LEGACY_DIGEST = {
  midnight: "f8396c5c842bc5a21e9ec224e346855325648c8b0b6f2aaba884fcc526de7974",
  flat: "f747d53d852251deceef3879271df0145f9a933974894b4421d080de5ce3dab9",
  remake: "54afa5de7b2e2d60782cb7b54f41f682616f5fd711fa4fbf8a22d478976dc5c7",
};

describe("(c) 既存出力の不変とプリセット表", () => {
  it("既存 TemplateSpec（既定・flatContent・Re-make）の出力は変更前と同一", async () => {
    expect(await contentDigest(await writeTemplate(midnightSpec()))).toBe(LEGACY_DIGEST.midnight);
    const flat: TemplateSpec = { name: "Flat", fonts: { major: "Arial", minor: "Arial", majorEa: "MS Gothic" }, palette: { ...MIDNIGHT_PALETTE, background: "123456" }, flatContent: true };
    expect(await contentDigest(await writeTemplate(flat))).toBe(LEGACY_DIGEST.flat);
    const remake = masterToTemplateSpec(await loadTemplate(readFileSync(CANON)), { name: "Canon Re-make" });
    expect(await contentDigest(await writeTemplate(remake))).toBe(LEGACY_DIGEST.remake);
  });

  it("REPORT_PRESET（既存相当）の出力は、同じ名前・配色・書体の従来 TemplateSpec の出力と同一", async () => {
    expect(REPORT_PRESET.density).toEqual(BASE_DENSITY);
    expect(REPORT_PRESET.layouts).toEqual(BUILTIN_LAYOUTS.map((d) => d.name));
    const legacy: TemplateSpec = { name: REPORT_PRESET.name, fonts: { ...REPORT_PRESET.fonts }, palette: { ...REPORT_PRESET.palette } };
    expect(await contentDigest(await writePresetTemplate(REPORT_PRESET))).toBe(await contentDigest(await writeTemplate(legacy)));
    expect(await contentDigest(await writePresetTemplate(REPORT_PRESET))).toBe(LEGACY_DIGEST.midnight);
  });

  it("presetToSpec はレイアウトの部分集合をその順で解決し、生成テンプレは health ok", async () => {
    const names = ["Title.1Title.Single", "Section.1Title.Single", "Content.1Body.Single", "Column.2Body.Equal", "Closing.1Message.Single"];
    const preset: StylePreset = { ...REPORT_PRESET, name: "Subset", layouts: names };
    expect(presetToSpec(preset).layouts!.map((d) => d.name)).toEqual(names);
    const tpl = await loadTemplate(await writePresetTemplate(preset));
    expect(tpl.layouts.map((l) => l.name)).toEqual(names);
    expect(assessTemplateHealth(buildCatalog(tpl)).status).toBe("ok");
  });

  it("presetToSpec は外から渡したレイアウト集合（スタイル別定義）からも引け、未知の名前は throw", () => {
    const preset: StylePreset = { ...REPORT_PRESET, layouts: ["Content.1Body.Single", PIC_LAYOUT.name] };
    expect(presetToSpec(preset, [...BUILTIN_LAYOUTS, PIC_LAYOUT]).layouts!.map((d) => d.name)).toEqual(preset.layouts);
    expect(() => presetToSpec(preset)).toThrow(/Test\.1Body\.Single\+1Image/);
  });
});

describe("(d) #570 adjustTemplate とプリセットの一致", () => {
  const recipe = { fonts: { latin: [{ from: "Georgia", to: "Arial" }] }, scale: { title: 1.25, body: 1.1 } };

  it("adjustTemplate をプリセット出力に掛けた結果は、従来出力に掛けた結果と同一", async () => {
    const legacy: TemplateSpec = { name: REPORT_PRESET.name, fonts: { ...REPORT_PRESET.fonts }, palette: { ...REPORT_PRESET.palette } };
    const a = await adjustTemplate(await writePresetTemplate(REPORT_PRESET), recipe);
    const b = await adjustTemplate(await writeTemplate(legacy), recipe);
    expect(await contentDigest(a)).toBe(await contentDigest(b));
    const master = await partOf(a, "ppt/slideMasters/slideMaster1.xml");
    expect(master).toMatch(/<p:titleStyle><a:lvl1pPr[^>]*>(?:(?!<\/a:lvl1pPr>).)*<a:defRPr sz="5500"/); // 44pt × 1.25
    expect(master).toMatch(/<p:bodyStyle><a:lvl1pPr[^>]*>(?:(?!<\/a:lvl1pPr>).)*<a:defRPr sz="1550"/); // 14pt × 1.1 = 15.4 → 15.5
  });

  // PR #635 裁定 B: 倍率の対象は本文の大きさの帯（基準 14pt の 1.5 倍＝21pt 以下）の枠に限る（bodyMaxPt）。
  it("density.bodyPt は adjustTemplate の本文倍率（bodyPt ÷ 14・上限 21pt の枠まで）と同じ経路・同じ結果", async () => {
    expect(presetRecipe(REPORT_PRESET)).toEqual({});
    const pitchLike: StylePreset = { ...REPORT_PRESET, name: "Big Body", density: { ...BASE_DENSITY, bodyPt: 18 } };
    expect(presetRecipe(pitchLike)).toEqual({ scale: { body: 18 / BASE_DENSITY.bodyPt, bodyMaxPt: 21 } });
    const viaPreset = await writePresetTemplate(pitchLike);
    const viaAdjust = await adjustTemplate(await writeTemplate(presetToSpec(pitchLike)), { scale: { body: 18 / 14, bodyMaxPt: 21 } });
    expect(await contentDigest(viaPreset)).toBe(await contentDigest(viaAdjust));
    const tpl = await loadTemplate(viaPreset);
    expect(tpl.masterBodyStyle.fontSize).toBe(18);
    expect(tpl.masterTitleStyle.fontSize).toBe(44); // 見出しは不変
    expect(assessTemplateHealth(buildCatalog(tpl)).status).toBe("ok");
  });
});

describe("density.marginIn — 左右余白（LayoutDef の幾何を 1 経路で変換）", () => {
  it("既定 0.8in では LayoutDef をそのまま返す（同一オブジェクト）", () => {
    for (const d of BUILTIN_LAYOUTS) expect(withHorizontalMargin(d, BASE_DENSITY.marginIn)).toBe(d);
  });

  it("1.2in では本文枠の左端が 1.2in・右端が 13.333−1.2in に揃い、縦方向と装飾は不変", () => {
    const def = BUILTIN_LAYOUTS.find((d) => d.name === "Content.1Body.Single")!;
    const got = withHorizontalMargin(def, 1.2);
    const body = got.placeholders.find((p) => p.name === "Body.Center")!;
    expect(body.x).toBeCloseTo(1.2, 6);
    const src = def.placeholders.find((p) => p.name === "Body.Center")!;
    const k = (13.333 / 2 - 1.2) / (13.333 / 2 - 0.8);
    expect(body.w).toBeCloseTo(src.w * k, 6);
    got.placeholders.forEach((p, i) => {
      expect(p.y).toBe(def.placeholders[i].y);
      expect(p.h).toBe(def.placeholders[i].h);
    });
    expect(got.decos).toBe(def.decos);
  });

  it("marginIn を変えたプリセットも health ok で、レイアウト数と名前は不変", async () => {
    const roomy: StylePreset = { ...REPORT_PRESET, name: "Roomy", density: { ...BASE_DENSITY, marginIn: 1.2 } };
    const tpl = await loadTemplate(await writePresetTemplate(roomy));
    expect(tpl.layouts.map((l) => l.name)).toEqual(BUILTIN_LAYOUTS.map((d) => d.name));
    expect(assessTemplateHealth(buildCatalog(tpl)).status).toBe("ok");
  });
});
