/**
 * useMasterRegistry.ts — a GLOBAL registry of slide masters the user can pick from when starting a
 * draft (vs the old single hardcoded sample). The ACTIVE template stays per-document (useDocumentStore);
 * this only tracks WHICH masters are available to choose.
 *
 * Slice 1a: in-memory backend — the bundled sample is always present, plus any master imported this
 * session. Slice 1b（テーマ2 S6）: デスクトップでは master-store（app-local-data）へ同じ
 * インターフェースのまま永続化 — 起動時にハイドレートし、import/remove で書き添える。書込失敗や
 * ブラウザ実行では in-memory 動作のみに縮退する（UI・配線は不変）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadPersistedMasters, persistMaster, unpersistMaster } from "../ipc/master-store";

export interface MasterEntry {
  id: string;
  name: string; // display name (unique within the registry)
  builtin: boolean; // the bundled sample — always present, never removable
}

/** The bundled sample master — the default entry, so a first-run draft still has a template. */
export const BUILTIN_MASTER: MasterEntry = { id: "builtin", name: "Midnight Executive", builtin: true };
const BUILTIN_URL = "/templates/slide/Midnight_Executive_30_TemplateOnly.pptx";

/** Disambiguate a display name against the ones already registered: "Deck" → "Deck (2)". Pure. */
export function uniqueName(name: string, existing: readonly string[]): string {
  const base = name.trim() || "テンプレート";
  if (!existing.includes(base)) return base;
  for (let n = 2; ; n++) {
    const cand = `${base} (${n})`;
    if (!existing.includes(cand)) return cand;
  }
}

let seq = 0;

export function useMasterRegistry() {
  const [masters, setMasters] = useState<MasterEntry[]>([BUILTIN_MASTER]);
  // Mirror the list so importMaster computes the unique name off the LATEST list without a stale
  // closure or a state-updater side effect (which StrictMode would double-run).
  const mastersRef = useRef<MasterEntry[]>([BUILTIN_MASTER]);
  const bytesRef = useRef<Map<string, Uint8Array>>(new Map());

  // Slice 1b: 起動時に保存済みマスターをハイドレート（デスクトップのみ・ブラウザは即 []）。
  // StrictMode の二重実行は ref でガード。採番 seq は保存 id の最大値まで進めて衝突を防ぐ。
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    loadPersistedMasters()
      .then((persisted) => {
        if (persisted.length === 0) return;
        const entries: MasterEntry[] = [];
        for (const m of persisted) {
          if (mastersRef.current.some((e) => e.id === m.id)) continue;
          const taken = [...mastersRef.current, ...entries].map((e) => e.name);
          entries.push({ id: m.id, name: uniqueName(m.name, taken), builtin: false });
          bytesRef.current.set(m.id, m.bytes);
          seq = Math.max(seq, Number(m.id.slice(1)));
        }
        const next = [...mastersRef.current, ...entries];
        mastersRef.current = next;
        setMasters(next);
      })
      .catch(() => {}); // 読めなくても in-memory レジストリとして成立する
  }, []);

  /** Register imported .pptx bytes as a new master and return its entry (already selectable). */
  const importMaster = useCallback((rawName: string, bytes: Uint8Array): MasterEntry => {
    const id = `m${++seq}`;
    const name = uniqueName(rawName, mastersRef.current.map((m) => m.name));
    const entry: MasterEntry = { id, name, builtin: false };
    const next = [...mastersRef.current, entry];
    mastersRef.current = next;
    setMasters(next);
    bytesRef.current.set(id, bytes);
    void persistMaster(id, name, bytes).catch(() => {}); // 書込失敗しても登録自体は有効（セッション内）
    return entry;
  }, []);

  /** The master's raw .pptx bytes (the bundled sample is fetched + cached on first use). */
  const getBytes = useCallback(async (id: string): Promise<Uint8Array> => {
    const cached = bytesRef.current.get(id);
    if (cached) return cached;
    if (id === BUILTIN_MASTER.id) {
      const res = await fetch(BUILTIN_URL);
      if (!res.ok) throw new Error(`内蔵テンプレートの読み込みに失敗しました (${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      bytesRef.current.set(id, bytes);
      return bytes;
    }
    throw new Error(`master not found: ${id}`);
  }, []);

  /** Remove an imported master (the bundled sample can't be removed). */
  const removeMaster = useCallback((id: string) => {
    if (id === BUILTIN_MASTER.id) return;
    const next = mastersRef.current.filter((m) => m.id !== id);
    mastersRef.current = next;
    setMasters(next);
    bytesRef.current.delete(id);
    void unpersistMaster(id).catch(() => {});
  }, []);

  return { masters, importMaster, getBytes, removeMaster };
}
