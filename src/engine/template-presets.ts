/**
 * template-presets.ts — スタイル別テンプレの「プリセット表」（#594・#580 段 2-b・純粋ロジック R2）。
 *
 * スタイル＝配色・書体・密度（本文サイズ・左右余白）＋レイアウトの部分集合（#580 段 1: 報告書 6 変種は
 * 選ばれるレイアウトが全スライドで一致し、差は配色と書体だけだった）。プリセットは TemplateSpec に
 * 落として writeTemplate に渡す。幾何の正本は LayoutDef の 1 経路（R8）で、密度は既存の経路に乗せる:
 *   - bodyPt: #570 の adjustTemplate の本文倍率（bodyPt ÷ MASTER_BODY_PT）。第 2 のサイズ規則を作らない。
 *   - marginIn: LayoutDef の枠を左右方向に縮める純粋変換 withHorizontalMargin（既定 0.8in では恒等）。
 * 具体的なスタイル（Pitch / Executive / Campaign）は #595/#596/#598 で足す。プリセット専用の LayoutDef
 * （BUILTIN_LAYOUTS に入れると既存出力が変わるもの）は PRESET_LAYOUTS に置き、既定の `library`
 * （PRESET_LIBRARY）から名前で引く。
 */
import { BUILTIN_LAYOUTS, type LayoutDef, type PaletteKey } from "./template-layout-library";
import { PRESET_LAYOUTS } from "./template-layout-library-style";
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

/** プリセットが名前で引けるレイアウト全体: 内蔵（BUILTIN_LAYOUTS）＋プリセット専用（PRESET_LAYOUTS）。 */
export const PRESET_LIBRARY: readonly LayoutDef[] = [...BUILTIN_LAYOUTS, ...PRESET_LAYOUTS];

/** プリセット → TemplateSpec（レイアウトは `library` から名前で引き、余白を掛ける）。未知の名前は throw。 */
export function presetToSpec(preset: StylePreset, library: readonly LayoutDef[] = PRESET_LIBRARY): TemplateSpec {
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

/**
 * セールスピッチ「Pitch」（#595・#580 段 2-c）。提案・ピッチ用: 1 枚 1 メッセージ（目安 3 行・60 字以下）。
 *  - 配色: canvas 白・background 濃紺・accent は高彩度の 1 色（朱）・emphasis＝accent（数値を目立たせる）。
 *    accent / accent2 は白地で 3:1 以上（大きな太字の数値・ラベルに使う。WCAG の大きい文字の基準）。
 *  - 書体: 見出しも本文も同じゴシック（太さはレイアウトの bold で分ける）。
 *  - 密度: 本文 18pt（#570 の本文倍率 18/14）・左右 0.8in（現行どおり）。
 *  - レイアウト 14: #580 段 1 の構成案 12 から調整（#595「実装時に微調整可」・すべて実測）。
 *      表紙は Title.1Title.Single（+1Meta は Date の枠が無く `Date:` が消える）。
 *      Content.1Body.Single を追加（図や画像の無い本文が全幅に入る。無いと図が Media の画像枠に入る）。
 *      「カード 3（group card）」は Summary.3Block.Equal（新・結論帯つき）。内蔵語彙にカード用が無く、
 *      Column.3Body.Equal に落ちると `:icon:` が文字のまま残り、`Takeaway:` は本文の先頭へ救済される。
 *      Column.3Body.Equal は `<!-- col -->` の受け皿として残す（無いと 2〜3 列の本文が消える）。
 *    ロゴ壁 Gallery.4Image.Grid は #392（1 枚に複数画像）の後。
 */
export const PITCH_PRESET: StylePreset = Object.freeze({
  name: "セールスピッチ Pitch",
  palette: Object.freeze({
    background: "14213D",
    canvas: "FFFFFF",
    titleText: "FFFFFF",
    bodyText: "1F2937",
    subtle: "C7D2E4",
    muted: "6B7280",
    accent: "E8501C",
    accent2: "0284C7",
    emphasis: "E8501C",
  }),
  fonts: Object.freeze({ major: "Yu Gothic", minor: "Yu Gothic" }),
  layouts: Object.freeze([
    "Title.1Title.Single",
    "Statement.1Message.Single",
    "Content.1Body.Single",
    "Content.1Body.Single+1Callout",
    "Column.3Body.Equal",
    "Summary.3Block.Equal",
    "KPI.1Value.Single",
    "KPI.4Value.Grid",
    "Compare.2Option.Versus",
    "Process.4Step.Sequential",
    "Media.1Body+1Image",
    "Quote.1Message.Single+1Attribution",
    "Table.1Table.Single+1Source",
    "Closing.1CTA+1Contact",
  ]),
  density: Object.freeze({ ...BASE_DENSITY, bodyPt: 18 }),
}) as StylePreset;
