/**
 * layout-augment-plan.ts — マスター強化（#568 段 2）の「計画」半分: どのレイアウトを元にし、何列を足すか。
 *
 * 計画と適用を分ける（template-repair.ts の planRepairs / applyRepairs と同じ形）。ここは読み取りだけの
 * 純粋計算（R2）で、適用（XML 書き換え・検査ゲート）は layout-augment.ts。
 *
 * - 元にするレイアウト: role=content・タイトルあり・本文ちょうど 1 枠・絵/グラフ/表の枠なし・本文が
 *   スライド面積の 35% 以上かつ幅の 60% 以上。複数あれば装飾・画像・固定テキストの合計が少ない順
 *   （同点は文書順）。無ければ理由を返す（never-silent）。
 * - 足す N: 2 列 / 3 列のうち、catalog に columns×N（グループ型を除く）が無いものだけ。
 * - 列幅: 等分。ガター比率は LayoutDef（template-layout-library.ts）の Column.NBody.Equal から導く（R8）。
 * - 文字サイズ: column-font-shrink.ts の規則を、loader が読む実効サイズ（lvl1〜lvl4）に掛ける。
 */
import { slideRoleRegions, type LayoutInfo, type PlaceholderInfo, type TemplateData } from "./template-loader";
import type { SlideIR } from "./slide-schema";
import { isContentBody, placeholderRole, layoutRole, type LayoutCatalog } from "./template-catalog";
import { BUILTIN_LAYOUTS } from "./template-layout-library";
import { columnFontSize, DEFAULT_SHRINK_RULE, type ColumnCount, type ShrinkRule } from "./column-font-shrink";

export const AUGMENT_COLUMNS: readonly ColumnCount[] = [2, 3];

/** 本文がスライドに占める最小比率（面積・幅）。段 1 調査の推奨 2。 */
const MIN_BODY_AREA = 0.35;
const MIN_BODY_WIDTH = 0.6;
const CANONICAL_SLIDE = { w: 13.333, h: 7.5 };
/** 本文の idx に使わない番号: 10〜16（ADR-0023 の META 予約）と 50（スライド番号）。 */
const RESERVED_IDX = (n: number) => (n >= 10 && n <= 16) || n === 50;

export interface AugmentBase {
  layoutIndex: number; // slideLayout${n}.xml の n（LayoutInfo.index）
  layoutName: string;
  bodyIdx: string; // 分割する本文枠の idx
  box: { x: number; y: number; w: number; h: number }; // 本文枠（inch・継承込み）
  sourceSizes: number[]; // 元の本文枠の lvl1..lvl4 の実効 pt（loader が読む値）
}

export interface AugmentAddition {
  columns: ColumnCount;
  name: string; // 新レイアウト名
  idxs: string[]; // 左の列から順の placeholder idx（idx 昇順 ＝ 本文の序数順）
  levelSizes: number[]; // 各列の lvl1..lvl4 の pt（規則適用後）
}

export interface AugmentPlan {
  rule: ShrinkRule;
  base?: AugmentBase;
  add: AugmentAddition[];
  skipped: Array<{ columns: ColumnCount; reason: string }>;
  reason?: string; // base が無いときの理由（UI にそのまま出す）
}

export interface AugmentOptions {
  rule?: ShrinkRule;
  columns?: readonly ColumnCount[];
}

/** LayoutDef の Column.NBody.Equal から、ガター ÷ 本文の全幅（左端の列の左〜右端の列の右）。 */
export function columnGutterRatio(columns: ColumnCount): number {
  const def = BUILTIN_LAYOUTS.find((d) => d.name === `Column.${columns}Body.Equal`);
  const cols = (def?.placeholders ?? []).filter((p) => p.type === "body" && p.idx >= 1 && p.idx <= 9).sort((a, b) => a.x - b.x);
  if (cols.length < 2) throw new Error(`LayoutDef Column.${columns}Body.Equal not found`);
  const last = cols[cols.length - 1];
  return (cols[1].x - (cols[0].x + cols[0].w)) / (last.x + last.w - cols[0].x);
}

/** 新レイアウト名。ドット区切りの規約名マスター（classifyLayout の T1 が名前優先）では Column.* を名乗る。 */
export function augmentedLayoutName(baseName: string, columns: ColumnCount, existing: readonly string[]): string {
  if (layoutRole(baseName) === "other") return `${baseName} +${columns}Body`;
  const canonical = `Column.${columns}Body.Equal`;
  return existing.includes(canonical) ? `Column.${columns}Body.Augmented` : canonical;
}

const decorCount = (l: LayoutInfo) => l.decorations.length + l.images.length + l.staticTexts.length;

/** 元にする本文枠を選ぶ。見つからなければ理由。 */
export function selectAugmentBase(
  layouts: readonly LayoutInfo[],
  catalog: LayoutCatalog,
): { layout: LayoutInfo; body: PlaceholderInfo } | { reason: string } {
  const cands: Array<{ layout: LayoutInfo; body: PlaceholderInfo; order: number }> = [];
  let sawTitleBody = false;
  layouts.forEach((layout, order) => {
    const e = catalog[order];
    if (!e || e.role !== "content" || !e.hasTitle || e.bodyCount !== 1) return;
    sawTitleBody = true;
    if (layout.placeholders.some((p) => ["picture", "chart", "table"].includes(placeholderRole(p)))) return;
    const body = layout.placeholders.find(isContentBody);
    if (!body) return;
    const slide = body.slideSize ?? CANONICAL_SLIDE;
    const { w, h } = body.style;
    if (w * h < MIN_BODY_AREA * slide.w * slide.h || w < MIN_BODY_WIDTH * slide.w) return;
    cands.push({ layout, body, order });
  });
  if (cands.length === 0)
    return {
      reason: sawTitleBody
        ? "タイトルと本文 1 枠のレイアウトはありますが、本文枠が小さい（面積 35% 未満または幅 60% 未満）か、画像・グラフ・表の枠があるため、元にできません。"
        : "タイトル枠と本文 1 枠を持つレイアウトが無いため、元にするレイアウトを決められません。",
    };
  cands.sort((a, b) => decorCount(a.layout) - decorCount(b.layout) || a.order - b.order);
  return cands[0];
}

/** 左の列から順に使う idx。PowerPoint 標準の 1..9 の空き（元の本文 idx を含む）→ 足りなければ 17 以上。 */
function columnIdxs(layout: LayoutInfo, bodyIdx: string, n: number): string[] {
  const used = new Set(layout.placeholders.map((p) => p.idx).filter((i) => i !== bodyIdx));
  const pool: number[] = [];
  for (let i = 1; i <= 9; i++) if (!used.has(String(i))) pool.push(i);
  for (let i = 17; pool.length < n; i++) if (!RESERVED_IDX(i) && !used.has(String(i))) pool.push(i);
  return pool.slice(0, n).map(String);
}

/** loader が読む実効サイズ（lvl1 と lvl2〜4）。プレビューが描く値と同じ（R8）。 */
function effectiveLevelSizes(body: PlaceholderInfo): number[] {
  const lv = body.style.levelFontSizes ?? [];
  return [body.style.fontSize, ...[0, 1, 2].map((i) => lv[i] ?? body.style.fontSize)];
}

/** 何を足すかを決める（読み取りのみ）。 */
export function planAugmentation(tpl: Pick<TemplateData, "layouts">, catalog: LayoutCatalog, opts: AugmentOptions = {}): AugmentPlan {
  const rule = opts.rule ?? DEFAULT_SHRINK_RULE;
  const wanted = opts.columns ?? AUGMENT_COLUMNS;
  const skipped: AugmentPlan["skipped"] = [];
  const missing = wanted.filter((n) => {
    const have = catalog.find((e) => e.role === "columns" && e.bodyCount === n && !e.groupKind);
    if (have) skipped.push({ columns: n, reason: `${n} 列のレイアウト「${have.name}」が既にあります。` });
    return !have;
  });
  const sel = selectAugmentBase(tpl.layouts, catalog);
  if ("reason" in sel) {
    for (const n of missing) skipped.push({ columns: n, reason: sel.reason });
    return { rule, add: [], skipped, reason: sel.reason };
  }
  const { layout, body } = sel;
  const names = tpl.layouts.map((l) => l.name);
  const src = effectiveLevelSizes(body);
  const base: AugmentBase = { layoutIndex: layout.index, layoutName: layout.name, bodyIdx: body.idx, box: { x: body.style.x, y: body.style.y, w: body.style.w, h: body.style.h }, sourceSizes: src };
  const add = missing.map((columns): AugmentAddition => {
    const name = augmentedLayoutName(layout.name, columns, names);
    names.push(name);
    return { columns, name, idxs: columnIdxs(layout, body.idx, columns), levelSizes: src.map((pt, i) => columnFontSize(pt, columns, rule, i + 1)) };
  });
  return { rule, base, add, skipped };
}

// One plan per loaded catalog (diagnostics run per slide; the plan only depends on the template).
const planCache = new WeakMap<LayoutCatalog, AugmentPlan>();

/**
 * 診断の案内文（#568・規則 `missing-column-layout`）: このスライドが N 列（auto 選択・グループ型でない）で、
 * テンプレに columns×N が無く、強化で足せるときだけ文を返す。スライドの意図は auto 選択と同じ
 * slideRoleRegions で読む（R8）。足せない（元にするレイアウトが無い）テンプレでは案内しない。
 */
export function columnAugmentHint(
  slide: SlideIR,
  slideIndex: number,
  totalSlides: number,
  catalog: LayoutCatalog,
  layouts: readonly LayoutInfo[],
  resolvedName: string,
): string | undefined {
  if (slide.layout !== "auto" || slide.groupKind) return undefined;
  const { role, regions } = slideRoleRegions(slide, slideIndex, totalSlides);
  if (role !== "columns" || !AUGMENT_COLUMNS.includes(regions as ColumnCount)) return undefined;
  let plan = planCache.get(catalog);
  if (!plan) planCache.set(catalog, (plan = planAugmentation({ layouts: [...layouts] }, catalog)));
  if (!plan.add.some((a) => a.columns === regions)) return undefined;
  return `このテンプレには ${regions} 列のレイアウトが無いため「${resolvedName}」に配置しました。「テンプレを強化」で ${regions} 列のレイアウトを追加できます（体裁はこのテンプレのまま）`;
}
