/**
 * useAiGeneration — Shared BYOK generation logic for the AI Assist surfaces.
 *
 * Both the AI dialog (LlmAssist) and the in-Edit AI dock (AiPanel) use this so
 * provider config + generation behaviour can never diverge between them.
 *
 * Split for the R1 400-line cap: framework-free types/constants/helpers live in ai-generation-types
 * (re-exported below so importers are unaffected); the bundled-runtime lifecycle is useBuiltinRuntime.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { LayoutCatalog } from "../engine/template-catalog";
import { generateWithAI, listProviderModels, providerPreset, isLocalTarget, type ProviderId } from "../ipc/ai";
import { parseDiagramType, type DiagramType } from "../engine/llm-prompts";
import { runningInTauri } from "../ipc/commands";
import { ensureEgressConsent } from "../ipc/egress-consent";
import { saveAiConfig, loadAiConfig, clearAiConfig } from "../ipc/key-store";
import {
  type AiProviderConfig, type AiConfigMap, type AiMode, type AiTask, type DiagramTypeChoice,
  LOCAL_ONLY_STORAGE, BEST_OF_N_STORAGE, clampBestOfN, MAX_TASKS, MODE_LABEL, defaultConfigs, loadSavedConfig, postProcessAiResult, computeConnection, freshBuiltin,
} from "./ai-generation-types";
import { useBuiltinRuntime } from "./useBuiltinRuntime";

// Backward-compatible surface: these used to be declared here, so re-export them for existing importers.
export type { DiagramTypeChoice, AiProviderConfig, AiConfigMap, BuiltinModelInfo, AiMode, AiTaskStatus, AiTask } from "./ai-generation-types";
export { LOCAL_ONLY_STORAGE, classifyAiFailure } from "./ai-generation-types";

export function useAiGeneration(catalog?: LayoutCatalog) {
  const [saved] = useState(loadSavedConfig);
  // Default to the bundled offline model on desktop (the product's offline-first north star);
  // the browser/demo build can't spawn a runtime, so it falls back to Claude. A saved choice wins.
  const [provider, setProvider] = useState<ProviderId>(saved.provider ?? (runningInTauri() ? "builtin" : "claude"));
  const [configs, setConfigs] = useState<AiConfigMap>(() => freshBuiltin(saved.configs ? { ...defaultConfigs(), ...saved.configs } : defaultConfigs()));
  const [rememberKey, setRememberKey] = useState(!!saved.configs);
  // Central AI task store: the live list (in-flight + history) + which task is the
  // "foreground" one whose result/error the single-shot surfaces (AiPanel/LlmAssist)
  // read. abortMap holds one AbortController per running task for cancellation.
  const [tasks, setTasks] = useState<AiTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const abortMap = useRef<Map<string, AbortController>>(new Map());
  const idCounter = useRef(0);
  // Best-of-N (single-slide edit): the N raw candidate results + whether the batch is in flight.
  // bestOfTaskIds lets cancel abort the whole fan-out. The picker/scoring live in AiPanel.
  const [candidates, setCandidates] = useState<string[]>([]);
  const [bestOfRunning, setBestOfRunning] = useState(false);
  const bestOfTaskIds = useRef<string[]>([]);
  // The document new tasks are stamped with + the visible list is filtered to — so each
  // project keeps its own AI history. App keeps this in sync with the active document.
  // Local-model-only mode: when ON, generation is hard-blocked from any non-local target
  // (enforced in canGenerate AND in generateWithAI). See LOCAL_ONLY_STORAGE.
  const [localModelOnly, setLocalModelOnlyState] = useState(saved.localOnly);
  // Best-of-N candidate count for single-slide edits (1 = off). setter HARD-clamps to [1,5] + persists.
  const [bestOfN, setBestOfNState] = useState(saved.bestOfN);
  const setBestOfN = useCallback((n: number) => {
    const c = clampBestOfN(n);
    setBestOfNState(c);
    try { localStorage.setItem(BEST_OF_N_STORAGE, String(c)); } catch { /* ignore quota */ }
  }, []);
  const [activeDocId, setActiveDocIdState] = useState<string>("");
  const activeDocIdRef = useRef<string>("");
  const setActiveDocId = useCallback((id: string) => {
    if (activeDocIdRef.current === id) return;
    activeDocIdRef.current = id;
    setActiveDocIdState(id);
    setActiveTaskId(null); // foreground result is per-doc — don't bleed across tabs
  }, []);
  // Setup-assist state: local Ollama probe (null = not yet checked) + once-flags.
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const hadSavedConfig = useRef(saved.hadSaved);
  const didAutoSelect = useRef(false);
  // Holds startBuiltin so runTask (defined earlier) can auto-start the runtime on first use
  // without a forward reference. Populated by an effect below.
  const startBuiltinRef = useRef<null | (() => Promise<string>)>(null);

  // Reconcile the persisted AI config from the OS keychain (desktop). It's an ASYNC read, so it
  // can't seed the sync initial state above — apply it on mount (and migrate any legacy localStorage
  // blob up into the keychain; see key-store). On a box with no keychain backend this transparently
  // reads the localStorage fallback instead. ADR-0016 F3.
  useEffect(() => {
    let cancelled = false;
    void loadAiConfig().then((raw) => {
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw) as { provider?: ProviderId; configs?: Partial<AiConfigMap> };
        if (parsed.configs) {
          setConfigs((c) => freshBuiltin({ ...c, ...parsed.configs }));
          if (parsed.provider) setProvider(parsed.provider);
          setRememberKey(true);
          hadSavedConfig.current = true; // don't let the fresh-install auto-select clobber a saved choice
        }
      } catch {
        /* malformed persisted config → keep current state */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Probe local Ollama once, so the UI can surface it — and, on a fresh install
  // (no saved config), auto-select it so a local-AI user can generate immediately.
  useEffect(() => {
    let cancelled = false;
    listProviderModels("ollama", providerPreset("ollama").baseURL, "")
      .then((list) => {
        if (cancelled) return;
        setOllamaModels(list);
        // On DESKTOP the default is the bundled builtin model, so don't auto-hop to Ollama (it
        // stays a one-click "🦙 Ollama → 使う"). On the browser/demo build (no builtin runtime),
        // keep auto-selecting Ollama so a local-AI user can generate immediately.
        if (!hadSavedConfig.current && !didAutoSelect.current && list.length > 0 && !runningInTauri()) {
          didAutoSelect.current = true;
          setProvider("ollama");
          setConfigs((c) => ({
            ...c,
            ollama: { ...c.ollama, model: list.includes(c.ollama.model) ? c.ollama.model : list[0] },
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setOllamaModels([]); // Ollama not reachable
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const preset = providerPreset(provider);
  const cfg = configs[provider];

  const setField = useCallback(
    (key: keyof AiProviderConfig, value: string) => {
      setConfigs((c) => ({ ...c, [provider]: { ...c[provider], [key]: value } }));
    },
    [provider],
  );

  // Installed/available models → a dropdown instead of free-text model names.
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshModels = useCallback(() => setRefreshTick((t) => t + 1), []);

  const curBaseURL = cfg.baseURL;
  const curApiKey = cfg.apiKey;
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional loading flag set as the fetch begins
    setModelsLoading(true);
    listProviderModels(provider, curBaseURL, curApiKey)
      .then((list) => {
        if (!cancelled) {
          setModels(list);
          setModelsError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setModels([]);
          setModelsError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, curBaseURL, curApiKey, refreshTick]);

  const canGenerate = useCallback(
    (userRequest: string) =>
      userRequest.trim().length > 0 &&
      cfg.model.trim().length > 0 &&
      // builtin auto-starts on generate (desktop), so it needn't already have a baseURL.
      (preset.native || cfg.baseURL.trim().length > 0 || (provider === "builtin" && runningInTauri())) &&
      (!preset.keyRequired || cfg.apiKey.trim().length > 0) &&
      !(localModelOnly && !isLocalTarget(provider, cfg.baseURL)), // local-only: no cloud target
    [cfg, preset, localModelOnly, provider],
  );

  // Mode-specific post-processing centralised in ai-generation-types (pure); bind it to `catalog`
  // so every task path (foreground + loop) shapes responses identically.
  const postProcess = useCallback((mode: AiMode, raw: string) => postProcessAiResult(mode, raw, catalog), [catalog]);

  const patchTask = useCallback((id: string, patch: Partial<AiTask>) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const enqueue = useCallback((prompt: string, mode: AiMode, label: string, diagramType?: DiagramTypeChoice): AiTask => {
    const task: AiTask = { id: `t${++idCounter.current}`, docId: activeDocIdRef.current, mode, label, prompt, status: "running", result: "", startedAt: Date.now(), ...(diagramType ? { diagramType } : {}) };
    setTasks((ts) => [task, ...ts].slice(0, MAX_TASKS));
    return task;
  }, []);

  // Run ONE task: stream into its result, post-process, settle status. Resolves with
  // the cleaned result; rejects on error/cancel (the loop awaits this).
  const runTask = useCallback(
    async (task: AiTask, externalSignal?: AbortSignal): Promise<string> => {
      const controller = new AbortController();
      // Let an external signal (e.g. the refine loop's) abort this task's HTTP too.
      if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      abortMap.current.set(task.id, controller);
      try {
        // Auto-start the bundled runtime on first use (no manual "有効化" required). Use the
        // returned URL directly — cfg.baseURL in this closure is stale until the next render.
        let baseURL = cfg.baseURL;
        if (provider === "builtin" && !baseURL.trim() && startBuiltinRef.current) {
          baseURL = await startBuiltinRef.current();
        }
        // Consent gate (ADR-0016 F1): the FIRST send to a non-preset cloud host prompts for an
        // explicit OK (the request carries the API key); preset/local hosts pass silently, and a
        // trusted host is remembered. Runs BEFORE any generateWithAI, so no key is sent unapproved.
        await ensureEgressConsent(baseURL);
        // Stage 1 (diagram, おまかせ): resolve the TYPE with a quick route call so Stage 2 sends ONLY that
        // type's shape prompt. A concrete user choice skips the call; a parse miss falls back to flowchart.
        let diagramType: DiagramType | undefined;
        if (task.mode === "diagram" && task.diagramType) {
          if (task.diagramType === "auto") {
            const routed = await generateWithAI({
              provider, apiKey: cfg.apiKey, baseURL, model: cfg.model,
              mode: "diagram-route", userRequest: task.prompt,
              signal: controller.signal, localOnly: localModelOnly,
            });
            diagramType = parseDiagramType(routed) ?? "flowchart";
            patchTask(task.id, { diagramType });
          } else {
            diagramType = task.diagramType;
          }
        }
        const raw = await generateWithAI({
          provider, apiKey: cfg.apiKey, baseURL, model: cfg.model,
          mode: task.mode, userRequest: task.prompt,
          ...(diagramType ? { diagramType } : {}),
          onText: (t) => patchTask(task.id, { result: t }),
          signal: controller.signal,
          localOnly: localModelOnly, // hard egress block at the chokepoint
        });
        const pp = postProcess(task.mode, raw);
        if (pp.error) {
          patchTask(task.id, { status: "error", error: pp.error, finishedAt: Date.now() });
          throw new Error(pp.error);
        }
        patchTask(task.id, { status: "done", result: pp.result ?? "", ...(pp.notice ? { notice: pp.notice } : {}), finishedAt: Date.now() });
        return pp.result ?? "";
      } catch (e) {
        if (controller.signal.aborted) {
          patchTask(task.id, { status: "cancelled", finishedAt: Date.now() });
          throw new Error("cancelled", { cause: e });
        }
        const msg = e instanceof Error ? e.message : String(e);
        patchTask(task.id, { status: "error", error: msg, finishedAt: Date.now() });
        throw e;
      } finally {
        abortMap.current.delete(task.id);
      }
    },
    [provider, cfg, patchTask, postProcess, localModelOnly],
  );

  const persistConfig = useCallback(() => {
    // Persist the config (incl. the BYOK key) to the OS keychain on desktop, else localStorage
    // (ADR-0016 F3). Fire-and-forget: a keychain write must not block the generate path.
    if (rememberKey) void saveAiConfig(JSON.stringify({ provider, configs: freshBuiltin(configs) }));
    else void clearAiConfig();
  }, [rememberKey, provider, configs]);

  // Background submit (no foreground tracking) → returns the task id. Errors are
  // recorded on the task, not thrown here.
  const submit = useCallback(
    (prompt: string, mode: AiMode, label: string): string => {
      const task = enqueue(prompt, mode, label);
      void runTask(task).catch(() => {});
      return task.id;
    },
    [enqueue, runTask],
  );

  // Promise variant for the refine loop's per-slide aiFix — resolves with the result.
  // An optional signal lets the loop's cancel abort this in-flight call.
  const submitAndWait = useCallback(
    (prompt: string, mode: AiMode, label: string, signal?: AbortSignal): Promise<string> =>
      runTask(enqueue(prompt, mode, label), signal),
    [enqueue, runTask],
  );

  // Foreground generate (AiPanel / LlmAssist): submit + track as the active task so
  // result/generating/error reflect it. No single-flight guard — extra clicks just add
  // tasks (all kept in history); the UI disables the button while generating.
  const generate = useCallback(
    (userRequest: string, mode: AiMode, diagramType?: DiagramTypeChoice) => {
      if (!canGenerate(userRequest)) return;
      persistConfig();
      setCandidates([]); // a fresh single generation supersedes any prior best-of-N candidate set
      const task = enqueue(userRequest, mode, MODE_LABEL[mode], diagramType);
      setActiveTaskId(task.id);
      void runTask(task).catch(() => {});
    },
    [canGenerate, persistConfig, enqueue, runTask],
  );

  // Self-repair single-retry (ADR-0019 ①, Option A): re-run a slide edit with a harness-authored
  // ops-bias prompt when the first attempt drifted to full-Markdown. Same machinery as generate
  // (enqueue + track active so result/generating reflect it); a distinct label marks it in history.
  // Caller (AiPanel) enforces "once per user-generate" so this never loops.
  const retry = useCallback(
    (prompt: string) => {
      const task = enqueue(prompt, "slide", "🔁 opsで再生成");
      setActiveTaskId(task.id);
      void runTask(task).catch(() => {});
    },
    [enqueue, runTask],
  );

  // Best-of-N (ADR-0019 ① Option B): fan out N generations for ONE instruction, collect the raw
  // candidates; AiPanel scores each via the adoption gate and shows the best + a picker. Runs via
  // Promise.all — the external API parallelizes; the builtin server serializes/parallelizes per its
  // slot count (RAM-aware --parallel, Rust). Falls back to whatever candidates succeed.
  const generateBest = useCallback(
    async (userRequest: string, mode: AiMode, n: number) => {
      if (!canGenerate(userRequest)) return;
      persistConfig();
      setCandidates([]);
      setBestOfRunning(true);
      const batch = Array.from({ length: n }, (_, i) => enqueue(userRequest, mode, `${MODE_LABEL[mode]} 候補${i + 1}/${n}`));
      bestOfTaskIds.current = batch.map((t) => t.id);
      setActiveTaskId(batch[0].id); // stream the first into the foreground while the rest run
      try {
        const results = await Promise.all(batch.map((t) => runTask(t).catch(() => "")));
        setCandidates(results.filter((r) => r.trim()));
      } finally {
        setBestOfRunning(false);
      }
    },
    [canGenerate, persistConfig, enqueue, runTask],
  );
  const clearCandidates = useCallback(() => setCandidates([]), []);

  const cancel = useCallback(() => {
    if (bestOfRunning) bestOfTaskIds.current.forEach((id) => abortMap.current.get(id)?.abort()); // abort the whole fan-out
    else if (activeTaskId) abortMap.current.get(activeTaskId)?.abort();
  }, [activeTaskId, bestOfRunning]);
  const cancelTask = useCallback((id: string) => abortMap.current.get(id)?.abort(), []);
  const clearTasks = useCallback(() => {
    setTasks((ts) => ts.filter((t) => t.status === "running")); // keep in-flight, drop history
  }, []);

  // Hide the foreground result/diff (e.g. after apply) without losing it from history.
  const reset = useCallback(() => { setActiveTaskId(null); setCandidates([]); }, []);
  // Back-compat for LlmAssist's manual paste: record it as a done task + make it active.
  const setResult = useCallback((text: string) => {
    const task: AiTask = { id: `t${++idCounter.current}`, docId: activeDocIdRef.current, mode: "slides", label: "手動入力", prompt: "(manual)", status: "done", result: text, startedAt: Date.now(), finishedAt: Date.now() };
    setTasks((ts) => [task, ...ts].slice(0, MAX_TASKS));
    setActiveTaskId(task.id);
  }, []);

  // Foreground-task views the single-shot surfaces read (derived from the task store).
  const activeTask = activeTaskId ? tasks.find((t) => t.id === activeTaskId) : undefined;
  const result = activeTask?.result ?? "";
  const generating = activeTask?.status === "running";
  const error = activeTask?.status === "error" ? (activeTask.error ?? "エラー") : null;
  // Non-blocking 告知 for a completed task (e.g. a corrupt unit was dropped by deterministic repair).
  const notice = activeTask?.status === "done" ? (activeTask.notice ?? null) : null;

  // One-click: switch to local Ollama, picking a valid installed model.
  const switchToOllama = useCallback(() => {
    setProvider("ollama");
    setConfigs((c) => ({
      ...c,
      ollama: {
        ...c.ollama,
        model: ollamaModels && ollamaModels.length && !ollamaModels.includes(c.ollama.model) ? ollamaModels[0] : c.ollama.model,
      },
    }));
  }, [ollamaModels]);

  // The bundled llamafile runtime (download/spawn/stop). Injects the config setters so it owns only
  // the runtime state; startBuiltin is published to startBuiltinRef so runTask can auto-start on use.
  const { builtinStatus, weightsPresent, builtinModel, startBuiltin, switchToBuiltin, stopBuiltin } = useBuiltinRuntime({ setConfigs, setProvider });
  useEffect(() => {
    startBuiltinRef.current = startBuiltin;
  }, [startBuiltin]);

  // Toggle local-only: persist UNCONDITIONALLY; if turning ON while pointed at a cloud
  // target, hop to local Ollama so the user can still generate.
  const setLocalModelOnly = useCallback(
    (on: boolean) => {
      setLocalModelOnlyState(on);
      try {
        localStorage.setItem(LOCAL_ONLY_STORAGE, on ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (on && !isLocalTarget(provider, configs[provider].baseURL)) switchToOllama();
    },
    [provider, configs, switchToOllama],
  );
  // The current provider/endpoint would be blocked by local-only (UI lock badge).
  const localBlocked = localModelOnly && !isLocalTarget(provider, cfg.baseURL);

  // A human-readable connection status for the CURRENT provider + an actionable hint when it isn't
  // ready — derived by the pure computeConnection (ai-generation-types) from the resolved state.
  const connection = computeConnection({ provider, preset, cfg, builtinStatus, weightsPresent, builtinModel, modelsLoading, modelsError, models });

  // Only the active document's tasks are surfaced (history is partitioned per project).
  const docTasks = tasks.filter((t) => t.docId === activeDocId);

  return {
    provider, setProvider,
    configs, cfg, preset, setField,
    rememberKey, setRememberKey,
    generating, result, setResult, error, notice,
    canGenerate, generate, retry, generateBest, candidates, bestOfRunning, clearCandidates, cancel, reset,
    tasks: docTasks, setActiveDocId, submit, submitAndWait, cancelTask, clearTasks,
    models, modelsError, modelsLoading, refreshModels,
    ollamaModels, switchToOllama, connection,
    switchToBuiltin, stopBuiltin, builtinStatus, weightsPresent, builtinModel,
    localModelOnly, setLocalModelOnly, localBlocked,
    bestOfN, setBestOfN,
  };
}

/** The shared AI generation instance. Lifted to App and passed to every AI surface
 *  (AiPanel, LlmAssist) + the refine loop so provider/key config never diverges. */
export type AiGeneration = ReturnType<typeof useAiGeneration>;
