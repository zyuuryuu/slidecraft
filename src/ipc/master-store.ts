/**
 * master-store.ts — マスターレジストリの永続化バックエンド（テーマ2 S6 / Slice 1b）。
 *
 * デスクトップ（Tauri）では app-local-data の `masters/` に index.json ＋ `<id>.pptx` を保存し、
 * 起動時に useMasterRegistry がハイドレートする。ブラウザ（dev/demo）では何もしない
 * （従来どおりセッション内のみ）。インターフェースはフック側と疎結合 — 失敗は縮退
 * （読めないエントリはスキップ・書込失敗は登録自体を妨げない）で、レジストリの
 * in-memory 動作は常に成立する。
 */
import { runningInTauri } from "./commands";

export interface MasterIndexEntry {
  id: string; // m<number>（セッション採番と同じ形式。"builtin" は永続化対象外）
  name: string;
}

export interface PersistedMaster extends MasterIndexEntry {
  bytes: Uint8Array;
}

const DIR = "masters";
const INDEX = `${DIR}/index.json`;

/** index.json の防御的パース: 壊れた/型不正な入力は黙って捨てる（純粋・テスト対象）。 */
export function parseMasterIndex(json: string): MasterIndexEntry[] {
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (e): e is MasterIndexEntry =>
          typeof e === "object" && e !== null &&
          typeof (e as MasterIndexEntry).id === "string" && /^m\d+$/.test((e as MasterIndexEntry).id) &&
          typeof (e as MasterIndexEntry).name === "string",
      )
      .map((e) => ({ id: e.id, name: e.name }));
  } catch {
    return [];
  }
}

export function serializeMasterIndex(entries: readonly MasterIndexEntry[]): string {
  return JSON.stringify(entries.map((e) => ({ id: e.id, name: e.name })));
}

type FsApi = typeof import("@tauri-apps/plugin-fs");
async function fsApi(): Promise<{ fs: FsApi; base: { baseDir: number } }> {
  const fs = await import("@tauri-apps/plugin-fs");
  return { fs, base: { baseDir: fs.BaseDirectory.AppLocalData } };
}

async function readIndex(fs: FsApi, base: { baseDir: number }): Promise<MasterIndexEntry[]> {
  if (!(await fs.exists(INDEX, base))) return [];
  return parseMasterIndex(await fs.readTextFile(INDEX, base));
}

/** 保存済みマスターを全て読み込む（起動時ハイドレート用）。bytes の読めないエントリはスキップ。 */
export async function loadPersistedMasters(): Promise<PersistedMaster[]> {
  if (!runningInTauri()) return [];
  try {
    const { fs, base } = await fsApi();
    const out: PersistedMaster[] = [];
    for (const e of await readIndex(fs, base)) {
      try {
        out.push({ ...e, bytes: await fs.readFile(`${DIR}/${e.id}.pptx`, base) });
      } catch {
        // ファイル欠損は index から消える（次の persist/unpersist で再書込）— 起動は止めない
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** マスター1件を保存し index を更新する。失敗は throw（呼び出し側で握りつぶす想定）。 */
export async function persistMaster(id: string, name: string, bytes: Uint8Array): Promise<void> {
  if (!runningInTauri()) return;
  const { fs, base } = await fsApi();
  await fs.mkdir(DIR, { ...base, recursive: true });
  await fs.writeFile(`${DIR}/${id}.pptx`, bytes, base);
  const index = (await readIndex(fs, base)).filter((e) => e.id !== id);
  index.push({ id, name });
  await fs.writeTextFile(INDEX, serializeMasterIndex(index), base);
}

/** マスター1件を削除し index を更新する。 */
export async function unpersistMaster(id: string): Promise<void> {
  if (!runningInTauri()) return;
  const { fs, base } = await fsApi();
  const index = (await readIndex(fs, base)).filter((e) => e.id !== id);
  await fs.writeTextFile(INDEX, serializeMasterIndex(index), base);
  try {
    await fs.remove(`${DIR}/${id}.pptx`, base);
  } catch {
    // index からは既に外れている — ファイル残骸は無害
  }
}
