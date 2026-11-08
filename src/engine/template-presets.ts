/**
 * template-presets.ts — スタイル別テンプレの「プリセット表」（#594・#580 段 2-b・純粋ロジック R2）。
 *
 * スタイル＝配色・書体・密度（本文サイズ・左右余白）＋レイアウトの部分集合（#580 段 1: 報告書 6 変種は
 * 選ばれるレイアウトが全スライドで一致し、差は配色と書体だけだった）。プリセットは TemplateSpec に
 * 落として writeTemplate に渡す。幾何の正本は LayoutDef の 1 経路（R8）で、密度は既存の経路に乗せる:
 *   - bodyPt: #570 の adjustTemplate の本文倍率（bodyPt ÷ MASTER_BODY_PT・本文の帯 21pt 以下の枠だけ＝
 *     PRESET_BODY_MAX_PT）。第 2 のサイズ規則を作らない。
 *   - marginIn: LayoutDef の枠を左右方向に縮める純粋変換 withHorizontalMargin（既定 0.8in では恒等）。
 *   - maxBodyLines / maxLineChars（#596）: 文字量の目標帯。生成テンプレのメタ（style-meta.ts）に書き、
 *     get_deck_issues の density-target が読む。目標の無いプリセット（REPORT_PRESET）の出力は不変。
 * 具体的なスタイル（Pitch / Executive / Campaign）は #595/#596/#598 で足す。そのスタイル別 LayoutDef は
 * PRESET_LIBRARY（BUILTIN_LAYOUTS ＋ プリセット専用）から名前で引く。
 */
import { BUILTIN_LAYOUTS, type LayoutDef, type PaletteKey } from "./template-layout-library";
import { PRESET_ONLY_LAYOUTS } from "./template-layout-library-style";
import { writeTemplate, MIDNIGHT_PALETTE, MASTER_BODY_PT, SLIDE_W, type TemplateSpec } from "./template-writer";
import { adjustTemplate, type TemplateAdjustRecipe } from "./template-adjust";
import { withStyleDensityMeta, hasDensityTargets, type StyleDensity } from "./style-meta";

export type { StyleDensity } from "./style-meta";

export interface StylePreset {
  name: string;
  palette: Record<PaletteKey, string>; // hex（# なし）
  fonts: TemplateSpec["fonts"];
  // レイアウト名の部分集合（この順で出力）。slide-schema の LayoutName ではなく string なのは、
  // 内蔵の +1Kicker やスタイル別 LayoutDef（#593 以降）が LAYOUT_NAMES に無い名前を持つため。
  layouts: readonly string[];
  density: StyleDensity;
}

/** プリセットが名前で引くレイアウトの全集合: 内蔵（BUILTIN_LAYOUTS）＋プリセット専用（#596〜）。 */
export const PRESET_LIBRARY: readonly LayoutDef[] = Object.freeze([...BUILTIN_LAYOUTS, ...PRESET_ONLY_LAYOUTS]);

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
 * エグゼクティブ（インパクト重視・#596）。ダークの navy に高彩度の accent 1 色（大数字も同色）、本文は明るい
 * グレー。見出しは太いゴシック（Arial Black ＋ 游ゴシック）、本文は同系（Arial ＋ 游ゴシック）。
 * 1 枚 1 メッセージ: 結論先出しの表紙・ステートメント・要約（箇条＋ Takeaway）・巨大 KPI・3 点要約・Ask 締め。
 * 密度は本文 20pt・左右 1.0in・本文 3 行／1 行 45 字（超えたら get_deck_issues が density-target を出す）。
 */
export const EXECUTIVE_PRESET: StylePreset = Object.freeze({
  name: "Executive",
  palette: Object.freeze({
    background: "0A1430", // 表紙・章扉・締めの地／本文スライドのヘッダーバー
    canvas: "111C3D", // 本文スライドの地（ダーク）
    titleText: "FFFFFF",
    bodyText: "DCE2EC", // 明るいグレー
    subtle: "A9B4C8",
    muted: "7D89A3",
    accent: "FFB020", // 高彩度の 1 色
    accent2: "8FA6CC", // 比較の 2 つ目（彩度を落とし、accent を 1 色に保つ）
    emphasis: "FFB020", // 大数字・Takeaway は accent と同じ色
  }),
  fonts: Object.freeze({ major: "Arial Black", minor: "Arial", majorEa: "Yu Gothic", minorEa: "Yu Gothic" }),
  layouts: Object.freeze([
    "Title.1Title.Single", // 結論先出しの表紙（タイトル＋サブタイトルに 1 文の結論）
    "Statement.1Message.Single",
    "Content.1Body.Single",
    "Content.1Body.Single+1Callout", // 要約 1 枚（箇条 3 つ＋ Takeaway）
    "KPI.1Value.Single", // 巨大 KPI
    "KPI.3Value.Equal",
    "Compare.2Option.Versus",
    "Process.3Step.Sequential",
    "Column.2Body.Equal", // 2 列の本文（無いと 3 列枠に入り 1 列が空く）
    "Column.3Body.Equal", // 3 点要約（カード 3）
    "Section.1Title.Single", // タイトルだけのスライド（マーカー無しの章扉）
    // `<!-- section -->` の章扉: 書き出し時に materializeDerivedSlides が章一覧付きでこの名前に固定する
    // （deck-sections.ts）。無いと本文レイアウトに落ちる。
    "SectionNav.1TitleList.Single",
    "Closing.1Ask+1Decision", // Ask 締め（プリセット専用）
  ]),
  density: Object.freeze({ bodyPt: 20, marginIn: 1.0, maxBodyLines: 3, maxLineChars: 45 }),
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
export function presetToSpec(preset: StylePreset, library: readonly LayoutDef[] = PRESET_LIBRARY): TemplateSpec {
  const byName = new Map(library.map((d) => [d.name, d] as const));
  const layouts = preset.layouts.map((name) => {
    const def = byName.get(name);
    if (!def) throw new Error(`StylePreset "${preset.name}": unknown layout "${name}"`);
    return withHorizontalMargin(def, preset.density.marginIn);
  });
  return { name: preset.name, fonts: { ...preset.fonts }, palette: { ...preset.palette }, layouts };
}

/**
 * 本文倍率を掛ける枠の上限（pt）＝本文の大きさの帯（基準 14pt の 1.5 倍）。これを超える枠は大数字・
 * ステートメントなど表示用サイズで、幅は基準サイズ前提のため倍率を掛けると溢れる（PR #635 裁定 B）。
 */
export const PRESET_BODY_MAX_PT = MASTER_BODY_PT * 1.5;

/** 密度のうちサイズ分を #570 の変換レシピに落とす（基準どおりなら空＝無変換）。倍率は本文の帯の枠だけ。 */
export function presetRecipe(preset: StylePreset): TemplateAdjustRecipe {
  const body = preset.density.bodyPt / MASTER_BODY_PT;
  return body === 1 ? {} : { scale: { body, bodyMaxPt: PRESET_BODY_MAX_PT } };
}

/**
 * プリセットからテンプレを生成する: writeTemplate → adjustTemplate（無変換なら writeTemplate の出力そのまま）
 * → 目標帯があればメタ（docProps/custom.xml）を書く（無ければ何も足さない）。
 */
export async function writePresetTemplate(preset: StylePreset, library?: readonly LayoutDef[]): Promise<Uint8Array> {
  const bytes = await adjustTemplate(await writeTemplate(presetToSpec(preset, library)), presetRecipe(preset));
  return hasDensityTargets(preset.density) ? withStyleDensityMeta(bytes, preset.density) : bytes;
}
