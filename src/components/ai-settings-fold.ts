/**
 * ai-settings-fold.ts — 「AIで生成」ダイアログ（LlmAssist）の接続設定の折りたたみ：開いた時点で展開するかの
 * 純粋な判定と、「畳んだ」の記憶（#669）。
 *
 * 記憶は版に依らない単一フラグ（#236 と同じ流儀・先例 onboarding-state.ts）。手動コピペで使う利用者
 * （接続を設定しない人）が、開くたびに畳む操作を強いられないようにする。localStorage が無い・例外を
 * 投げる（プライベートモード等）ときは「記憶なし」として従来どおり動く。
 */
import type { ConnectionStatus } from "./ai-generation-types";

export const AI_SETTINGS_FOLDED_KEY = "slidecraft_ai_settings_folded";

/** 開いた時点で設定を展開するか：利用者の操作が要り（computeConnection が決める・R8）、かつ畳んだ記憶が無いとき。 */
export function initialSettingsOpen(conn: Pick<ConnectionStatus, "needsUserAction">, folded: boolean): boolean {
  return foldOpenAtStart(conn.needsUserAction, folded);
}

/** 規則の本体（接続の型に依らない形）。pending＝利用者の操作が要る。協働パネルの「接続の設定」（#689）も使う。 */
export function foldOpenAtStart(pending: boolean, folded: boolean): boolean {
  return pending && !folded;
}

/** 「畳んだ」の記憶の次の値。記憶を決めるのはこの関数だけ（R8・#713／#743）。
 *  - prev: 今の記憶。nextOpen: 開閉の操作のあとの開閉（操作でなく接続が変わっただけなら null）。
 *  - 接続が使える（ok）なら常に消す（#743）: 別の入口（⚙ → AI 接続設定… や状態ピル）で直した利用者の記憶が残り、
 *    後で再び壊れたときに設定が展開されない穴を塞ぐ。待ち（確認中・起動中＝ok でも needsUserAction でもない）では
 *    消さない（起動直後の確認中に、手動コピペで使う利用者の記憶を消さない）。
 *  - 開閉の操作では、利用者の操作が要る（needsUserAction）状態で畳んだときだけ記憶する＝接続を設定しない
 *    （手動コピペで使う）利用者。開いた・問題なしで畳んだ操作は記憶を消す（#713）。
 *  - 操作が無いときは今の記憶のまま。
 *  ok・needsUserAction は読むだけ（書き手は computeConnection のみ）。 */
export function rememberFold(prev: boolean, nextOpen: boolean | null, conn: Pick<ConnectionStatus, "ok" | "needsUserAction">): boolean {
  return nextFoldMemory(prev, nextOpen, conn.ok, conn.needsUserAction);
}

/** rememberFold の本体（接続の型に依らない形）。resolved＝使える（ok）、pending＝利用者の操作が要る。 */
export function nextFoldMemory(prev: boolean, nextOpen: boolean | null, resolved: boolean, pending: boolean): boolean {
  if (resolved) return false;
  if (nextOpen === null) return prev;
  return !nextOpen && pending;
}

/** 単一フラグ（"1" かなし）の読み書き。キーごとに 1 つ。協働パネルの「接続の設定」（#689・collab-panel-view.ts）も
 *  同じ仕組みを使う（記憶の仕組みを増やさない）。 */
export function loadFolded(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function saveFolded(key: string, folded: boolean): void {
  try {
    if (folded) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* 記憶できなくても開閉そのものは動く */
  }
}

export const loadSettingsFolded = (): boolean => loadFolded(AI_SETTINGS_FOLDED_KEY);
export const saveSettingsFolded = (folded: boolean): void => saveFolded(AI_SETTINGS_FOLDED_KEY, folded);
