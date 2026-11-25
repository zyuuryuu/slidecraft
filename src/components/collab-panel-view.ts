/**
 * collab-panel-view.ts — #689: 協働パネルの 2 層（上＝状態 1 行＋停止・下＝「接続の設定」）のための
 * 純粋な判定。
 *
 *  - 一度つないだか（collabEverConnected）: 協働中（＝編集ロック中。判定は collab-lock.ts の collabEditLocked だけ・
 *    R8）か、許可したクライアントが 1 つ以上ある。許可はキーチェーンに残る（#727）ので、起動し直しても「つないだ後」。
 *  - 下の層を開くか・「畳んだ」の記憶: AI 生成ダイアログの接続設定（ai-settings-fold.ts・#669／#743）と同じ規則を
 *    そのまま使う。「つないだ」＝使える（ok）、「まだつないでいない」＝利用者の操作が要る、に当てる。
 *    記憶も同じ単一フラグの仕組み（loadFolded／saveFolded）でキーだけ別にする。
 *  - 状態行の文言（collabStatusView）: どの辞書キーを出すかをここだけで決める。
 */
import type { CollabStatus } from "../ipc/collab-projection";
import { foldOpenAtStart, loadFolded, nextFoldMemory, saveFolded } from "./ai-settings-fold";

export const COLLAB_SETUP_FOLDED_KEY = "slidecraft_collab_setup_folded";

export function collabEverConnected(s: { locked: boolean; grants: readonly unknown[] | undefined }): boolean {
  return s.locked || (s.grants?.length ?? 0) > 0;
}

/** 開閉を決めてよいか（統括レビュー 要修正 a）: 許可したクライアントを読み終えた（useCollab の grantsRead＝
 *  キーチェーンの許可を host に渡し終えた）か、協働中か、協働がそもそも使えない（ブラウザ版）。読み終える前に
 *  決めると、起動直後に開いてから畳む（ちらつく）。 */
export function collabSetupDecidable(s: { available: boolean; locked: boolean; grantsRead: boolean }): boolean {
  return !s.available || s.locked || s.grantsRead;
}

/** 規則は ai-settings-fold.ts だけが持つ（R8）。「つないだ」＝resolved、「まだつないでいない」＝pending に当てる。 */
export function initialSetupOpen(everConnected: boolean, folded: boolean): boolean {
  return foldOpenAtStart(!everConnected, folded);
}

export function rememberSetupFold(prev: boolean, nextOpen: boolean | null, everConnected: boolean): boolean {
  return nextFoldMemory(prev, nextOpen, everConnected, !everConnected);
}

export const loadSetupFolded = (): boolean => loadFolded(COLLAB_SETUP_FOLDED_KEY);
export const saveSetupFolded = (folded: boolean): void => saveFolded(COLLAB_SETUP_FOLDED_KEY, folded);

export type StatusKey = "statusCollaborating" | "waitingForAi" | "statusConnecting" | "statusError" | "statusDisconnected";

export interface CollabStatusView {
  key: StatusKey;
  /** The dot's colour class. */
  dot: string;
  /** 停止 (host running) or 再開 (stopped / failed); none while starting. */
  action: "stop" | "start" | null;
}

export function collabStatusView(status: CollabStatus, locked: boolean): CollabStatusView {
  if (status === "connected") {
    return locked
      ? { key: "statusCollaborating", dot: "bg-emerald-400", action: "stop" }
      : { key: "waitingForAi", dot: "bg-emerald-400/50", action: "stop" };
  }
  if (status === "connecting") return { key: "statusConnecting", dot: "bg-amber-400 animate-pulse", action: null };
  if (status === "error") return { key: "statusError", dot: "bg-rose-500", action: "start" };
  return { key: "statusDisconnected", dot: "bg-field", action: "start" };
}
