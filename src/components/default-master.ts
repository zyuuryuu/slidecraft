/**
 * default-master.ts — 起動時に既定テンプレ（BUILTIN_MASTER）を読み込む唯一の経路（#117）。
 *
 * bytes はマスターレジストリ（useMasterRegistry.getBytes）から取り、通常の受け入れゲート
 * （applyTemplateBytes）で適用する。URL は BUILTIN_MASTERS にしか書かない（R8）。失敗は黙らずに
 * notify で知らせる（never-silent）— テンプレ無しの白いプレビューを無言で出さない。
 */
import i18n from "../i18n";
import { BUILTIN_MASTER } from "./useMasterRegistry";

export interface DefaultMasterDeps {
  getBytes: (id: string) => Promise<Uint8Array>;
  apply: (bytes: Uint8Array, name: string) => Promise<{ ok: boolean }>;
  notify: (message: string) => void;
}

export type DefaultMasterOutcome =
  | { ok: true; id: string }
  | { ok: false; stage: "fetch" | "apply"; detail: string };

export async function loadDefaultMaster({ getBytes, apply, notify }: DefaultMasterDeps): Promise<DefaultMasterOutcome> {
  const { id, name } = BUILTIN_MASTER;
  let bytes: Uint8Array;
  try {
    bytes = await getBytes(id);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    notify(i18n.t("app.defaultTemplateLoadFailed", { name, detail }));
    return { ok: false, stage: "fetch", detail };
  }
  const r = await apply(bytes, name);
  if (!r.ok) {
    // The gate already set parseError with the reason; the toast says WHICH template failed at startup.
    const detail = i18n.t("app.defaultTemplateRejected");
    notify(i18n.t("app.defaultTemplateLoadFailed", { name, detail }));
    return { ok: false, stage: "apply", detail };
  }
  return { ok: true, id };
}
