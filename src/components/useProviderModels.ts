/**
 * useProviderModels.ts — the provider's model list (→ dropdown) and, through it, the connection check.
 *
 * Split out of useAiGeneration.ts (R1). The fetched list is what computeConnection judges the connection
 * by (modelsLoading / modelsError / models) for EVERY provider, Claude included (#691: Claude used to show
 * green without ever asking the API, so a bogus key looked fine). When to ask is decided by the pure
 * planModelsQuery below:
 *  - Claude: after the key stops changing (debounce), once per key + endpoint, never under local-only
 *    (no cloud egress even for a check — ADR-0016 F3), never without a key.
 *  - Other providers: immediately on every change, as before.
 * The key itself never leaves this module except in the request (no logs, no UI, no error text).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CLAUDE_MODEL_CANDIDATES, listProviderModels, type ProviderId } from "../ipc/ai";
import i18n from "../i18n";

/** Wait this long after the last key edit before verifying a Claude key (typing a key = many edits). */
export const CLAUDE_VERIFY_DEBOUNCE_MS = 600;

export type ModelsQueryPlan =
  | { kind: "fetch"; delayMs: number; cacheKey: string | null }
  | { kind: "cached" }
  | { kind: "skip-local" }
  | { kind: "skip-nokey" };

/** Decide whether / when to ask the provider for its model list. Pure (unit-tested). */
export function planModelsQuery(a: {
  provider: ProviderId;
  baseURL: string;
  apiKey: string;
  localOnly: boolean;
  cachedKey: string | null;
  force: boolean;
}): ModelsQueryPlan {
  if (a.provider !== "claude") return { kind: "fetch", delayMs: 0, cacheKey: null };
  if (a.localOnly) return { kind: "skip-local" };
  if (!a.apiKey.trim()) return { kind: "skip-nokey" };
  const cacheKey = `${a.baseURL.trim()}\n${a.apiKey.trim()}`;
  if (!a.force && cacheKey === a.cachedKey) return { kind: "cached" };
  return { kind: "fetch", delayMs: CLAUDE_VERIFY_DEBOUNCE_MS, cacheKey };
}

interface ModelsState { models: string[]; error: string | null }

export function useProviderModels(provider: ProviderId, baseURL: string, apiKey: string, localOnly: boolean) {
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshModels = useCallback(() => setRefreshTick((t) => t + 1), []);
  // Last Claude verification (in memory only): same key + endpoint → reuse, don't ask again.
  const claudeCache = useRef<{ key: string; result: ModelsState } | null>(null);
  const lastTick = useRef(refreshTick);

  useEffect(() => {
    const force = lastTick.current !== refreshTick;
    lastTick.current = refreshTick;
    const plan = planModelsQuery({ provider, baseURL, apiKey, localOnly, cachedKey: claudeCache.current?.key ?? null, force });
    const apply = (s: ModelsState) => {
      setModels(s.models);
      setModelsError(s.error);
      setModelsLoading(false);
    };
    if (plan.kind !== "fetch") {
      apply(plan.kind === "cached" && claudeCache.current
        ? claudeCache.current.result
        : { models: [], error: plan.kind === "skip-local" ? i18n.t("aiStatus.localOnlyNoCheck") : null });
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    const run = () => {
      listProviderModels(provider, baseURL, apiKey)
        .then((list) => ({ models: list, error: null }), (e: unknown) => ({ models: [], error: e instanceof Error ? e.message : String(e) }))
        .then((result: ModelsState) => {
          if (cancelled) return;
          if (plan.cacheKey) claudeCache.current = { key: plan.cacheKey, result };
          apply(result);
        });
    };
    const timer = plan.delayMs > 0 ? setTimeout(run, plan.delayMs) : null;
    if (!timer) run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [provider, baseURL, apiKey, localOnly, refreshTick]);

  // What the model dropdown offers: the verified list, or — for Claude before / without a successful
  // check — the known candidates. Display only: the connection is judged on `models`, never on these.
  const modelChoices = models.length === 0 && provider === "claude" ? CLAUDE_MODEL_CANDIDATES : models;
  return { models, modelsError, modelsLoading, refreshModels, modelChoices };
}
