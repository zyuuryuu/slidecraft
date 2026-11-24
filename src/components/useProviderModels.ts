/**
 * useProviderModels.ts — the provider's model list (→ dropdown) and, through it, the connection check.
 *
 * Split out of useAiGeneration.ts (R1). The fetched list is what computeConnection judges the connection
 * by (modelsLoading / modelsError / models) for EVERY provider, Claude included (#691: Claude used to show
 * green without ever asking the API, so a bogus key looked fine). When to ask is decided by the pure
 * planModelsQuery below:
 *  - Claude: after the key stops changing (debounce), never under local-only (no cloud egress even for a
 *    check — ADR-0016 F3 — reported as `modelsSkipped: "local"`, not as an error, #712), never without a
 *    key. A DEFINITE answer (success / 401 / 403) is reused for the same key + endpoint; an inconclusive
 *    one (unreachable / 5xx / 429) is not, so the next switch or redisplay asks again (#712).
 *  - Other providers: immediately on every change, as before.
 * The key itself never leaves this module except in the request (no logs, no UI, no error text).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CLAUDE_MODEL_CANDIDATES, listProviderModels, type ProviderId } from "../ipc/ai";
import { verificationFailure } from "./ai-generation-types";

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

interface ModelsState { models: string[]; error: string | null; skipped: "local" | null }

/** After a fetch: the key to remember the result under, or null when it must not be reused (another
 *  provider, or an inconclusive failure — the key may well be fine once the network is back). Pure. */
export function cacheKeyAfter(plan: ModelsQueryPlan, error: string | null): string | null {
  if (plan.kind !== "fetch" || !plan.cacheKey) return null;
  return error === null || verificationFailure(error) !== "inconclusive" ? plan.cacheKey : null;
}

/** The state to show when the plan does not fetch. Pure. */
export function settledModelsState(plan: Exclude<ModelsQueryPlan, { kind: "fetch" }>, cached: ModelsState | null): ModelsState {
  if (plan.kind === "cached" && cached) return cached;
  return { models: [], error: null, skipped: plan.kind === "skip-local" ? "local" : null };
}

export function useProviderModels(provider: ProviderId, baseURL: string, apiKey: string, localOnly: boolean) {
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsSkipped, setModelsSkipped] = useState<"local" | null>(null);
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
      setModelsSkipped(s.skipped);
      setModelsLoading(false);
    };
    if (plan.kind !== "fetch") {
      apply(settledModelsState(plan, claudeCache.current?.result ?? null));
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    const run = () => {
      listProviderModels(provider, baseURL, apiKey)
        .then((list) => ({ models: list, error: null, skipped: null }), (e: unknown) => ({ models: [], error: e instanceof Error ? e.message : String(e), skipped: null }))
        .then((result: ModelsState) => {
          if (cancelled) return;
          const key = cacheKeyAfter(plan, result.error);
          if (plan.cacheKey) claudeCache.current = key ? { key, result } : null;
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
  return { models, modelsError, modelsLoading, modelsSkipped, refreshModels, modelChoices };
}
