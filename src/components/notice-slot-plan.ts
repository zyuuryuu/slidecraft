/**
 * notice-slot-plan.ts — #613: ツールバー直下の通知枠（NoticeSlot）に「今どの帯を出すか」を決める唯一の場所。
 *
 * 帯は同時に 1 本だけ出す。優先順は 接続の許可待ち ＞ 協働中のロック ＞ テンプレ調整 ＞ 取り込み（進行中・結果）＞ 更新通知:
 *  - 接続の許可待ち（#727・ADR-0040 D3）は AI の呼び出しが返事を待って止まっている（時間切れで
 *    authorization-pending になる）。判断は承認ダイアログで行い、帯は件数を示すだけ。
 *  - 協働中のロック（#689）は協働中ずっと出る 1 行（止まっているもの・理由・［停止］）。許可待ちが片づけば戻る。
 *  - テンプレ調整はユーザがいま操作している最中（プレビューを見ながら動かす・#579 でモーダルにしない）。
 *  - 取り込みはユーザの操作の直接の結果。
 *  - 更新通知は急がない（閉じなければ後で出る）。
 * 隠れた帯は消さない。前の帯が終われば次が出る（`hidden` は優先順のまま）。表示側はこれを呼ぶだけ（R8）。
 */

export type NoticeKind = "approval" | "collab" | "adjust" | "intake" | "update";

/** Priority order, highest first. */
export const NOTICE_PRIORITY: readonly NoticeKind[] = ["approval", "collab", "adjust", "intake", "update"];

export interface NoticeSlotState {
  /** #727: at least one AI client is waiting for [許可] (absent = none). */
  approval?: boolean;
  /** #689: collaborating = the GUI's structural edits are locked (collabEditLocked; absent = no). */
  collab?: boolean;
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

const ACTIVE: Record<NoticeKind, keyof NoticeSlotState> = { approval: "approval", collab: "collab", adjust: "adjusting", intake: "intake", update: "update" };

export function noticeSlotPlan(state: NoticeSlotState): NoticeSlotPlan {
  const active = NOTICE_PRIORITY.filter((k) => !!state[ACTIVE[k]]);
  return { shown: active[0] ?? null, hidden: active.slice(1) };
}
