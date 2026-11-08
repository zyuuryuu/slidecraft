/**
 * notice-slot-plan.ts — #613: ツールバー直下の通知枠（NoticeSlot）に「今どの帯を出すか」を決める唯一の場所。
 *
 * 帯は同時に 1 本だけ出す。優先順は テンプレ調整 ＞ 取り込み（進行中・結果）＞ 更新通知:
 *  - テンプレ調整はユーザがいま操作している最中（プレビューを見ながら動かす・#579 でモーダルにしない）。
 *  - 取り込みはユーザの操作の直接の結果。
 *  - 更新通知は急がない（閉じなければ後で出る）。
 * 隠れた帯は消さない。前の帯が終われば次が出る（`hidden` は優先順のまま）。表示側はこれを呼ぶだけ（R8）。
 */

export type NoticeKind = "adjust" | "intake" | "update";

/** Priority order, highest first. */
export const NOTICE_PRIORITY: readonly NoticeKind[] = ["adjust", "intake", "update"];

export interface NoticeSlotState {
  /** A template adjust session is open. */
  adjusting: boolean;
  /** An intake is running, or its (undismissed) result is on show. */
  intake: boolean;
  /** A newer version is available and not dismissed. */
  update: boolean;
}

export interface NoticeSlotPlan {
  /** The one band to show, or null when there is nothing to show. */
  shown: NoticeKind | null;
  /** The other active notices, in priority order (they appear once the shown one ends). */
  hidden: NoticeKind[];
}

const ACTIVE: Record<NoticeKind, keyof NoticeSlotState> = { adjust: "adjusting", intake: "intake", update: "update" };

export function noticeSlotPlan(state: NoticeSlotState): NoticeSlotPlan {
  const active = NOTICE_PRIORITY.filter((k) => state[ACTIVE[k]]);
  return { shown: active[0] ?? null, hidden: active.slice(1) };
}
