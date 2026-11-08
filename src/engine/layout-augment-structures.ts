/**
 * layout-augment-structures.ts — マスター強化（#568）で足せる「構造」の語彙と、その幾何・文字の比率。
 *
 * 段 2 は N 列（本文 1 枠を横に N 等分）だけ。段 3 で「見出し＋本文」の組を横に並べる 3 種を足す:
 *  - compare-2 … 比較（左右 2 案・見出し＋本文）。Compare.2Option.Versus 相当。
 *  - card-3    … カード 3 枚（見出し＋本文）。
 *  - kpi-3 / kpi-4 … KPI 行（数値＋ラベル ×3／×4）。
 *
 * 幾何はすべて BUILTIN_LAYOUTS（template-layout-library.ts）の LayoutDef から実行時に導く（R8・第 2 の幾何
 * 定義を作らない）。LayoutDef に完全一致の定義が無い 2 構造は、最も近い定義を組み合わせる（Issue/PR に記録）:
 *  - card-3: 横（ガター）は Column.3Body.Equal、縦（見出し高・間隔）と見出し/本文の文字比は
 *    Compare.2Option.Versus（見出し＋本文の組を持つ唯一の LayoutDef）。
 *  - kpi-4: 1 行 ×4 の LayoutDef は無い（KPI.4Value.Grid は 2×2 で 1 枠ずつ）ので KPI.3Value.Equal の比率を使う。
 *
 * 純粋計算のみ（R2）。
 */
import { BUILTIN_LAYOUTS } from "./template-layout-library";

export type ColumnStructure = "columns-2" | "columns-3";
export type GroupStructure = "compare-2" | "card-3" | "kpi-3" | "kpi-4";
export type AugmentStructure = ColumnStructure | GroupStructure;

/** 足す順（＝新レイアウトの番号順・GUI の一覧順）。 */
export const ALL_AUGMENT_STRUCTURES: readonly AugmentStructure[] = ["columns-2", "columns-3", "compare-2", "card-3", "kpi-3", "kpi-4"];
/** structures 省略時（段 2 と同じ）。 */
export const DEFAULT_AUGMENT_STRUCTURES: readonly AugmentStructure[] = ["columns-2", "columns-3"];

export interface GroupStructureSpec {
  kind: "compare" | "card" | "kpi"; // catalog の groupKind（detectGroups）と同じ語彙
  count: number; // 組の数（横に並ぶ数）
  gutterFrom: string; // 横のガター比率を取る LayoutDef
  slotsFrom: string; // 見出し/本文の縦比率・文字比・太字・揃えを取る LayoutDef
}

export const GROUP_STRUCTURES: Readonly<Record<GroupStructure, GroupStructureSpec>> = {
  "compare-2": { kind: "compare", count: 2, gutterFrom: "Compare.2Option.Versus", slotsFrom: "Compare.2Option.Versus" },
  "card-3": { kind: "card", count: 3, gutterFrom: "Column.3Body.Equal", slotsFrom: "Compare.2Option.Versus" },
  "kpi-3": { kind: "kpi", count: 3, gutterFrom: "KPI.3Value.Equal", slotsFrom: "KPI.3Value.Equal" },
  "kpi-4": { kind: "kpi", count: 4, gutterFrom: "KPI.3Value.Equal", slotsFrom: "KPI.3Value.Equal" },
};

export const isGroupStructure = (s: AugmentStructure): s is GroupStructure => s in GROUP_STRUCTURES;
export const columnsOf = (s: ColumnStructure): 2 | 3 => (s === "columns-2" ? 2 : 3);

/** 案内・理由文に出す日本語名（engine の理由文は従来どおり日本語）。 */
export const STRUCTURE_LABEL: Readonly<Record<AugmentStructure, string>> = {
  "columns-2": "2 列",
  "columns-3": "3 列",
  "compare-2": "比較（左右 2 案）",
  "card-3": "カード 3 枚",
  "kpi-3": "KPI 3 個",
  "kpi-4": "KPI 4 個",
};

type DefPh = (typeof BUILTIN_LAYOUTS)[number]["placeholders"][number];

/** LayoutDef の本文枠（idx 1..9）を x でまとめた列（左→右）。各列は上→下。 */
function defColumns(defName: string): DefPh[][] {
  const d = BUILTIN_LAYOUTS.find((x) => x.name === defName);
  const cells = (d?.placeholders ?? []).filter((p) => p.type === "body" && p.idx >= 1 && p.idx <= 9);
  if (cells.length === 0) throw new Error(`LayoutDef ${defName} not found`);
  const cols: DefPh[][] = [];
  for (const p of [...cells].sort((a, b) => a.x - b.x || a.y - b.y)) {
    const col = cols.find((c) => Math.abs(c[0].x - p.x) < 0.5);
    if (col) col.push(p);
    else cols.push([p]);
  }
  return cols.map((c) => c.sort((a, b) => a.y - b.y));
}

/** ガター ÷ 全幅（左端の列の左〜右端の列の右）。段 2 の columnGutterRatio もこれを使う（1 経路）。 */
export function layoutDefGutterRatio(defName: string): number {
  const cols = defColumns(defName);
  if (cols.length < 2) throw new Error(`LayoutDef ${defName} has fewer than 2 columns`);
  const first = cols[0][0];
  const last = cols[cols.length - 1][0];
  return (cols[1][0].x - (first.x + first.w)) / (last.x + last.w - first.x);
}

export interface StructureGeometry {
  gutterRatio: number; // ガター ÷ 本文の全幅
  headRatio: number; // 見出し枠の高さ ÷ 組の高さ（見出し上端〜本文下端）
  gapRatio: number; // 見出しと本文の間 ÷ 組の高さ
  headScale: number; // 見出しの文字 ÷ 本文の文字（LayoutDef の fontSize 比）
  headPtPerInch: number; // 見出しの文字 ÷ 見出し枠の幅（LayoutDef の pt/in）— 狭い列で数値が折り返さない上限に使う
  headBold: boolean;
  align?: "ctr"; // LayoutDef が中央揃えなら両枠に書く（KPI）
}

/** 組構造の幾何と文字比（LayoutDef から導出）。 */
export function structureGeometry(s: GroupStructure): StructureGeometry {
  const spec = GROUP_STRUCTURES[s];
  const [head, body] = defColumns(spec.slotsFrom)[0];
  if (!head || !body) throw new Error(`LayoutDef ${spec.slotsFrom} has no heading + body pair`);
  const total = body.y + body.h - head.y;
  return {
    gutterRatio: layoutDefGutterRatio(spec.gutterFrom),
    headRatio: head.h / total,
    gapRatio: (body.y - (head.y + head.h)) / total,
    headScale: head.fontSize / body.fontSize,
    headPtPerInch: head.fontSize / head.w,
    headBold: head.bold,
    ...(head.align === "ctr" && body.align === "ctr" ? { align: "ctr" as const } : {}),
  };
}
