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
  return conn.needsUserAction && !folded;
}

/** 開閉の操作のあとに「畳んだ」を記憶するか（#713）。記憶するのは、利用者の操作が要る（needsUserAction）状態で
 *  畳んだときだけ＝接続を設定しない（手動コピペで使う）利用者。使える状態で畳んだ・開いた操作は記憶を消す：
 *  設定を済ませて畳んだ人の接続が後で壊れたとき、開いた時点で設定が展開されるように。needsUserAction は読むだけ（R8）。 */
export function rememberFold(nextOpen: boolean, conn: Pick<ConnectionStatus, "needsUserAction">): boolean {
  return !nextOpen && conn.needsUserAction;
}

export function loadSettingsFolded(): boolean {
  try {
    return localStorage.getItem(AI_SETTINGS_FOLDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSettingsFolded(folded: boolean): void {
  try {
    if (folded) localStorage.setItem(AI_SETTINGS_FOLDED_KEY, "1");
    else localStorage.removeItem(AI_SETTINGS_FOLDED_KEY);
  } catch {
    /* 記憶できなくても開閉そのものは動く */
  }
}
