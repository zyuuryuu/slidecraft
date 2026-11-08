/**
 * overflow-scale-hint.ts — #570 段 3: 溢れ（`*-overflow`）が N 件あるとき「本文を 0.9 倍にすると溢れ N→M 件」の
 * 提案（info 1 件）を作る純関数。
 *
 * - 倍率は OVERFLOW_SCALE_CANDIDATES（0.95 / 0.9 / 0.85）を大きい順に試し、溢れが 0 になる最大の倍率を選ぶ。
 *   どれも 0 にならなければ最も減る倍率（同数なら大きい方）。1 件も減らなければ提案しない。
 * - 評価は「元テンプレ bytes → adjustTemplate（本文だけ倍率）→ loadTemplate → buildCatalog → diagnoseDeck」。
 *   容量見積りは diagnoseDeck が使う placeholderCapacity の 1 経路のまま（デッキ側に倍率を持たない・R8）。
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

/** 提案を計算する。溢れが無い／どの倍率でも減らないなら undefined。 */
export async function suggestBodyScale(templateBytes: Uint8Array, deck: DeckIR): Promise<OverflowScaleSuggestion | undefined> {
  const before = overflowsWith(deck, await loadTemplate(templateBytes));
  if (before === 0) return undefined;
  let best: OverflowScaleSuggestion | undefined;
  for (const scale of [...OVERFLOW_SCALE_CANDIDATES].sort((a, b) => b - a)) {
    const after = overflowsWith(deck, await loadTemplate(await adjustTemplate(templateBytes, { scale: { body: scale } })));
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
    message: `本文の文字サイズを ${s.scale} 倍にすると、溢れが ${s.before}→${s.after} 件になります（テンプレート調整で派生テンプレートを作って適用・元のテンプレートは不変）`,
  };
}
