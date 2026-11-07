/**
 * useTemplateAdjust.ts — #570 段 2「テンプレ調整」の状態とライフサイクル（App から切り出し・R1）。
 *
 * - start(): 今のマスターの bytes を「元テンプレ」として固定し、theme の書体スロットを読む。デッキも退避する
 *   （プレビュー中に容量が変わるとデッキの自動分割＝re-fit が走り得るので、キャンセルで戻すため）。
 * - preview(recipe): **元テンプレ＋レシピ**から毎回派生を作ってゲート経由で適用する（調整の上塗りをしない）。
 *   連打は直列化し、最後に要求されたレシピだけが最終的に適用される（古い結果が新しい結果を上書きしない）。
 * - apply(recipe): 最新レシピの派生を「<元名>（調整）」としてマスター一覧に登録・選択する。元テンプレは
 *   一覧にそのまま残る（元ファイルは書き換えない）。
 * - cancel(): 元テンプレを適用し直し、デッキを退避分へ戻す。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AdjustResult, ApplyTemplateResult } from "./apply-template";
import { isNoopRecipe, readThemeFontSlots, type TemplateAdjustRecipe, type ThemeFontSlots } from "../engine/template-adjust";
import type { MasterEntry } from "./useMasterRegistry";
import type { DeckIR } from "../engine/slide-schema";

export interface AdjustSession {
  sourceName: string;
  bytes: Uint8Array;
  slots: ThemeFontSlots;
}

interface Deps {
  masters: MasterEntry[];
  masterId: string;
  getMasterBytes: (id: string) => Promise<Uint8Array>;
  registerMaster: (name: string, bytes: Uint8Array) => MasterEntry;
  setMasterId: (id: string) => void;
  /** Apply the source bytes as-is (the controller's gated applyMasterBytes). */
  applySource: (bytes: Uint8Array, name: string) => Promise<ApplyTemplateResult>;
  /** Apply source + recipe as a derived template (the controller's applyMasterBytesAsAdjusted). */
  applyAdjusted: (bytes: Uint8Array, recipe: TemplateAdjustRecipe, name: string) => Promise<AdjustResult>;
  deck: DeckIR | null;
  restoreDeck: (deck: DeckIR | null) => void;
}

const key = (r: TemplateAdjustRecipe) => JSON.stringify(r);

export function useTemplateAdjust(d: Deps) {
  const { t } = useTranslation();
  const [session, setSession] = useState<AdjustSession | null>(null);
  const [busy, setBusy] = useState(false);
  const deckRef = useRef(d.deck);
  useEffect(() => { deckRef.current = d.deck; }, [d.deck]);
  const snapshot = useRef<DeckIR | null>(null);
  // Serialisation: one adjust at a time; the latest requested recipe wins.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef<string>("");
  const applied = useRef<{ key: string; bytes?: Uint8Array }>({ key: "" });
  // Set once apply/cancel begins: a debounced preview firing in that window must not land AFTER the
  // source is restored (or after the derived master is registered).
  const closing = useRef(false);

  const { masters, masterId, getMasterBytes, registerMaster, setMasterId, applySource, applyAdjusted, restoreDeck } = d;
  const adjustedName = useCallback((s: AdjustSession) => s.sourceName + t("app.adjustSuffix"), [t]);

  const start = useCallback(async () => {
    const entry = masters.find((m) => m.id === masterId);
    if (!entry) return;
    const bytes = await getMasterBytes(masterId).catch(() => null);
    if (!bytes) return;
    snapshot.current = deckRef.current;
    closing.current = false;
    applied.current = { key: key({}) };
    latest.current = key({});
    setSession({ sourceName: entry.name, bytes, slots: await readThemeFontSlots(bytes) });
  }, [masters, masterId, getMasterBytes]);

  const run = useCallback((s: AdjustSession, recipe: TemplateAdjustRecipe): Promise<void> => {
    latest.current = key(recipe);
    chain.current = chain.current.then(async () => {
      if (latest.current !== key(recipe) || applied.current.key === key(recipe)) return; // superseded / already shown
      setBusy(true);
      try {
        const r = await applyAdjusted(s.bytes, recipe, adjustedName(s));
        if (r.ok) applied.current = { key: key(recipe), bytes: r.adjustedBytes };
      } finally {
        setBusy(false);
      }
    });
    return chain.current;
  }, [adjustedName, applyAdjusted]);

  const preview = useCallback((recipe: TemplateAdjustRecipe) => {
    if (session && !closing.current) void run(session, recipe);
  }, [session, run]);

  const cancel = useCallback(async () => {
    if (!session) return;
    closing.current = true;
    latest.current = "";
    await chain.current;
    if (applied.current.key !== key({})) await applySource(session.bytes, session.sourceName);
    if (deckRef.current !== snapshot.current) restoreDeck(snapshot.current);
    setSession(null);
  }, [session, applySource, restoreDeck]);

  const apply = useCallback(async (recipe: TemplateAdjustRecipe) => {
    if (!session) return;
    if (isNoopRecipe(recipe)) return cancel(); // nothing to keep → back to the source, no new master
    closing.current = true;
    await run(session, recipe);
    const done = applied.current;
    if (done.key === key(recipe) && done.bytes) {
      const entry = registerMaster(adjustedName(session), done.bytes);
      setMasterId(entry.id);
    }
    setSession(null);
  }, [session, run, cancel, registerMaster, setMasterId, adjustedName]);

  return { session, busy, start, preview, apply, cancel };
}
