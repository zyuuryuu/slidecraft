/**
 * overflow-scale-hint.ts — #570 段 3: 溢れ（`*-overflow`）が N 件あるとき「本文を 0.9 倍にすると溢れ N→M 件」の
 * 提案（info 1 件）を作る純関数。
 *
 * - 倍率は OVERFLOW_SCALE_CANDIDATES（0.95 / 0.9 / 0.85）を大きい順に試し、溢れが 0 になる最大の倍率を選ぶ。
 *   どれも 0 にならなければ最も減る倍率（同数なら大きい方）。1 件も減らなければ提案しない。
 * - 評価は「候補倍率の試算テンプレ → loadTemplate → buildCatalog → diagnoseDeck」。試算テンプレの作り方は
 *   呼び出し側が `trial` で渡す（既定は今の bytes に adjustTemplate で本文だけ倍率）。MCP は派生（元テンプレ
 *   bytes ＋ レシピ）を adjust_template と同じ build で作り直す関数を渡す — 前回倍率を掛けた派生テンプレで
 *   「今の bytes × 候補倍率」と「元 bytes × 絶対レシピ」が食い違わないように（PR #682 統括レビュー・R8）。
 *   容量見積りは diagnoseDeck が使う placeholderCapacity の 1 経路のまま（デッキ側に倍率を持たない・R8）。
 *   倍率を掛ける枠の範囲も adjustTemplate の中（bodyMaxPtFor）の 1 経路: プリセット由来のテンプレでは
 *   プリセットが倍率を掛けた枠だけ（KPI の大数字など表示用の枠は据え置き）。adjust_template／GUI の適用も
 *   同じ関数を通るので、提案の予告件数と実際の適用結果は一致する（#670）。
 * - 溢れが無ければ何もしない（既存デッキの診断は不変）。元の bytes は書き換えない（adjustTemplate は派生を返す）。
 *
 * 純粋ロジック（R2）: JSZip と文字列処理（adjustTemplate / loadTemplate）だけ。
 */
import { diagnoseDeck, type DeckIssue } from "./deck-diagnostics";
import { adjustTemplate } from "./template-adjust";
import { loadTemplate, type TemplateData } from "./template-loader";
import { buildCatalog } from "./template-catalog";
import type { DeckIR } from "./slide-schema";

export const OVERFLOW_SCALE_CANDIDATES: readonly number[] = [0.95, 0.9, 0.85];

export interface OverflowScaleSuggestion {
  scale: number; // 本文（body 系統）の倍率
  before: number; // 今の溢れ件数
  after: number; // その倍率で調整したテンプレでの溢れ件数
}

const isOverflow = (i: DeckIssue) => typeof i.id === "string" && i.id.endsWith("-overflow");

/** `*-overflow`（body / title / table）の件数。 */
export function countOverflows(issues: readonly DeckIssue[]): number {
  return issues.filter(isOverflow).length;
}

const overflowsWith = (deck: DeckIR, t: TemplateData) => countOverflows(diagnoseDeck(deck, buildCatalog(t), t.layouts));

/** 候補倍率（今の本文に掛ける相対倍率）→ 試算テンプレの bytes。undefined＝その倍率では作れない（候補から外す）。 */
export type BodyScaleTrial = (factor: number) => Promise<Uint8Array | undefined>;

/** 提案を計算する。溢れが無い／どの倍率でも減らないなら undefined。`templateBytes` は今のテンプレ（before の基準）。 */
export async function suggestBodyScale(
  templateBytes: Uint8Array,
  deck: DeckIR,
  trial: BodyScaleTrial = (factor) => adjustTemplate(templateBytes, { scale: { body: factor } }),
): Promise<OverflowScaleSuggestion | undefined> {
  const before = overflowsWith(deck, await loadTemplate(templateBytes));
  if (before === 0) return undefined;
  let best: OverflowScaleSuggestion | undefined;
  for (const scale of [...OVERFLOW_SCALE_CANDIDATES].sort((a, b) => b - a)) {
    const bytes = await trial(scale);
    if (!bytes) continue;
    const after = overflowsWith(deck, await loadTemplate(bytes));
    if (after === 0) return { scale, before, after };
    if (after < before && (!best || after < best.after)) best = { scale, before, after };
  }
  return best;
}

/** 提案を DeckIssue（info・id overflow-scale-hint）にする。置き場は最初に溢れているスライド。 */
export function overflowScaleIssue(s: OverflowScaleSuggestion, issues: readonly DeckIssue[]): DeckIssue {
  const first = issues.filter(isOverflow).sort((a, b) => a.slideIndex - b.slideIndex)[0];
  return {
    slideIndex: first?.slideIndex ?? 0,
    title: first?.title ?? "",
    level: "info",
    id: "overflow-scale-hint",
    levers: [],
    message: `本文の文字サイズを ${s.scale} 倍にすると、溢れが ${s.before}→${s.after} 件になります（テンプレ調整で派生テンプレを作って適用・元テンプレは不変）`,
  };
}
