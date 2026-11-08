/**
 * template-presets.ts — スタイル別テンプレの「プリセット表」（#594・#580 段 2-b・純粋ロジック R2）。
 *
 * スタイル＝配色・書体・密度（本文サイズ・左右余白）＋レイアウトの部分集合（#580 段 1: 報告書 6 変種は
 * 選ばれるレイアウトが全スライドで一致し、差は配色と書体だけだった）。プリセットは TemplateSpec に
 * 落として writeTemplate に渡す。幾何の正本は LayoutDef の 1 経路（R8）で、密度は既存の経路に乗せる:
 *   - bodyPt: #570 の adjustTemplate の本文倍率（bodyPt ÷ MASTER_BODY_PT）。第 2 のサイズ規則を作らない。
 *   - marginIn: LayoutDef の枠を左右方向に縮める純粋変換 withHorizontalMargin（既定 0.8in では恒等）。
 * 具体的なスタイル（Pitch / Executive / Campaign）は #595/#596/#598 で足す。そのスタイル別 LayoutDef は
 * presetToSpec の `library` に BUILTIN_LAYOUTS と並べて渡す。
 */
import { BUILTIN_LAYOUTS, type LayoutDef, type PaletteKey } from "./template-layout-library";
import { writeTemplate, MIDNIGHT_PALETTE, MASTER_BODY_PT, SLIDE_W, type TemplateSpec } from "./template-writer";
import { adjustTemplate, type TemplateAdjustRecipe } from "./template-adjust";

export interface StyleDensity {
  bodyPt: number; // 本文の基準サイズ（pt）。MASTER_BODY_PT との比で本文系のサイズ全体に掛かる
  marginIn: number; // 左右の余白（inch）。BASE_DENSITY.marginIn からの差で枠を左右に縮める／広げる
}

export interface StylePreset {
  name: string;
  palette: Record<PaletteKey, string>; // hex（# なし）
  fonts: TemplateSpec["fonts"];
  // レイアウト名の部分集合（この順で出力）。slide-schema の LayoutName ではなく string なのは、
  // 内蔵の +1Kicker やスタイル別 LayoutDef（#593 以降）が LAYOUT_NAMES に無い名前を持つため。
  layouts: readonly string[];
  density: StyleDensity;
}

/** 現行の writer 既定と同じ密度（本文 14pt・左右 0.8in）。 */
export const BASE_DENSITY: Readonly<StyleDensity> = Object.freeze({ bodyPt: MASTER_BODY_PT, marginIn: 0.8 });

/**
 * 最初のプリセット＝既存相当の報告書（回帰確認用）。作成 UI の既定（Midnight 配色・Georgia/Calibri・
 * 内蔵全レイアウト）と同じで、出力は従来の TemplateSpec 出力と同一（tests/template-presets.test.ts）。
 */
export const REPORT_PRESET: StylePreset = Object.freeze({
  name: "Generated Midnight",
  palette: Object.freeze({ ...MIDNIGHT_PALETTE }),
  fonts: Object.freeze({ major: "Georgia", minor: "Calibri" }),
  layouts: Object.freeze(BUILTIN_LAYOUTS.map((d) => d.name)),
  density: BASE_DENSITY,
}) as StylePreset;

/**
 * 左右の余白を `marginIn` にする。枠（placeholder）の x/w をスライド中心まわりに一様に縮める（広げる）:
 * 基準余白 0.8in の位置が `marginIn` に来る。縦方向・装飾（全幅のヘッダーバー等）は触らない。
 * 基準と同じ値なら入力をそのまま返す（既存出力の不変）。
 */
export function withHorizontalMargin(def: LayoutDef, marginIn: number): LayoutDef {
  if (marginIn === BASE_DENSITY.marginIn) return def;
  const c = SLIDE_W / 2;
  if (!(marginIn >= 0 && marginIn < c)) throw new RangeError(`marginIn out of range: ${marginIn}`);
  const k = (c - marginIn) / (c - BASE_DENSITY.marginIn);
  return { ...def, placeholders: def.placeholders.map((p) => ({ ...p, x: c + (p.x - c) * k, w: p.w * k })) };
}

/** プリセット → TemplateSpec（レイアウトは `library` から名前で引き、余白を掛ける）。未知の名前は throw。 */
export function presetToSpec(preset: StylePreset, library: readonly LayoutDef[] = BUILTIN_LAYOUTS): TemplateSpec {
  const byName = new Map(library.map((d) => [d.name, d] as const));
  const layouts = preset.layouts.map((name) => {
    const def = byName.get(name);
    if (!def) throw new Error(`StylePreset "${preset.name}": unknown layout "${name}"`);
    return withHorizontalMargin(def, preset.density.marginIn);
  });
  return { name: preset.name, fonts: { ...preset.fonts }, palette: { ...preset.palette }, layouts };
}

/** 密度のうちサイズ分を #570 の変換レシピに落とす（基準どおりなら空＝無変換）。 */
export function presetRecipe(preset: StylePreset): TemplateAdjustRecipe {
  const body = preset.density.bodyPt / MASTER_BODY_PT;
  return body === 1 ? {} : { scale: { body } };
}

/** プリセットからテンプレを生成する: writeTemplate → adjustTemplate（無変換なら writeTemplate の出力そのまま）。 */
export async function writePresetTemplate(preset: StylePreset, library?: readonly LayoutDef[]): Promise<Uint8Array> {
  return adjustTemplate(await writeTemplate(presetToSpec(preset, library)), presetRecipe(preset));
}
