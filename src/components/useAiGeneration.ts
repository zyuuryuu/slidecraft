/**
 * useAiGeneration — Shared BYOK generation logic for the AI Assist surfaces.
 *
 * Both the AI dialog (LlmAssist) and the in-Edit AI dock (AiPanel) use this so
 * provider config + generation behaviour can never diverge between them.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { extractDeckPlan, deckPlanToDeck, stripMarkdownFence } from "../engine/deck-plan";
import { serializeMd } from "../engine/md-serializer";
import { DiagramSpecSchema } from "../engine/schema";
import { diagramSpecToYaml } from "../engine/mermaid-to-diagram";
import { parseJsonLoose } from "../engine/json-salvage";
import { generateWithAI, listProviderModels, PROVIDERS, providerPreset, isLocalTarget, type ProviderId } from "../ipc/ai";

export const AI_CONFIG_STORAGE = "slidecraft_ai_config";
/** Local-model-only toggle persists to its OWN key, UNCONDITIONALLY (a security setting
 *  must not depend on the "remember API key" opt-in that gates AI_CONFIG_STORAGE). */
export const LOCAL_ONLY_STORAGE = "slidecraft_local_only";

export interface AiProviderConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}
export type AiConfigMap = Record<ProviderId, AiProviderConfig>;
export type AiMode = "slides" | "slide" | "condense" | "diagram" | "diagram-edit";

export type AiTaskStatus = "running" | "done" | "error" | "cancelled";
/** One AI request as a tracked task — the unit of the central task store. Every
 *  surface (AiPanel, LlmAssist, the refine loop) submits these, so progress, history
 *  and cancellation are uniform and a manual request can't silently collide with the
 *  loop's per-slide calls. */
export interface AiTask {
  id: string;
  docId: string; // the document this task belongs to (multi-document scoping)
  mode: AiMode;
  label: string; // human scope, e.g. "スライド3を整形" / "デッキ生成"
  prompt: string;
  status: AiTaskStatus;
  result: string; // streamed live, then post-processed on done
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

const MAX_TASKS = 50; // keep the most recent N in history

const MODE_LABEL: Record<AiMode, string> = {
  slides: "デッキ生成",
  slide: "スライド整形",
  diagram: "図の生成",
  "diagram-edit": "図の編集",
};

/** Classify a failed AI call so the refine loop can decide whether to retry: a cancel
 *  never retries; config/auth errors won't fix themselves; transient failures (network,
 *  timeout, rate-limit, 5xx, empty/garbled response) are worth another try or two. */
export function classifyAiFailure(e: unknown, signal?: AbortSignal): { cancelled: boolean; retryable: boolean; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (message === "cancelled" || signal?.aborted) return { cancelled: true, retryable: false, message };
  const m = message.toLowerCase();
  const permanent = /\b(401|403|404)\b|unauthorized|invalid api key|\bapi key\b|model not found|no such model/.test(m);
  return { cancelled: false, retryable: !permanent, message };
}

function defaultConfigs(): AiConfigMap {
  const out = {} as AiConfigMap;
  for (const p of PROVIDERS) {
    out[p.id] = { baseURL: p.baseURL, model: p.model, apiKey: "" };
  }
  return out;
}

/** Read persisted AI config ONCE — used as a lazy useState initializer (NOT a mount effect), so
 *  there is no synchronous setState / cascading render on mount. Seeds the state below + hadSavedConfig. */
function loadSavedConfig(): { localOnly: boolean; provider?: ProviderId; configs?: Partial<AiConfigMap>; hadSaved: boolean } {
  try {
    const localOnly = localStorage.getItem(LOCAL_ONLY_STORAGE) === "1";
    const raw = localStorage.getItem(AI_CONFIG_STORAGE);
    if (!raw) return { localOnly, hadSaved: false };
    const saved = JSON.parse(raw) as { provider?: ProviderId; configs?: Partial<AiConfigMap> };
    return { localOnly, provider: saved.provider, configs: saved.configs, hadSaved: true };
  } catch {
    return { localOnly: false, hadSaved: false };
  }
}

export function useAiGeneration() {
  const [saved] = useState(loadSavedConfig);
  const [provider, setProvider] = useState<ProviderId>(saved.provider ?? "claude");
  const [configs, setConfigs] = useState<AiConfigMap>(() => (saved.configs ? { ...defaultConfigs(), ...saved.configs } : defaultConfigs()));
  const [rememberKey, setRememberKey] = useState(!!saved.configs);
  // Central AI task store: the live list (in-flight + history) + which task is the
  // "foreground" one whose result/error the single-shot surfaces (AiPanel/LlmAssist)
  // read. abortMap holds one AbortController per running task for cancellation.
  const [tasks, setTasks] = useState<AiTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const abortMap = useRef<Map<string, AbortController>>(new Map());
  const idCounter = useRef(0);
  // The document new tasks are stamped with + the visible list is filtered to — so each
  // project keeps its own AI history. App keeps this in sync with the active document.
  // Local-model-only mode: when ON, generation is hard-blocked from any non-local target
  // (enforced in canGenerate AND in generateWithAI). See LOCAL_ONLY_STORAGE.
  const [localModelOnly, setLocalModelOnlyState] = useState(saved.localOnly);
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

  // Probe local Ollama once, so the UI can surface it — and, on a fresh install
  // (no saved config), auto-select it so a local-AI user can generate immediately.
  useEffect(() => {
    let cancelled = false;
    listProviderModels("ollama", providerPreset("ollama").baseURL, "")
      .then((list) => {
        if (cancelled) return;
        setOllamaModels(list);
        if (!hadSavedConfig.current && !didAutoSelect.current && list.length > 0) {
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
      (preset.native || cfg.baseURL.trim().length > 0) &&
      (!preset.keyRequired || cfg.apiKey.trim().length > 0) &&
      !(localModelOnly && !isLocalTarget(provider, cfg.baseURL)), // local-only: no cloud target
    [cfg, preset, localModelOnly, provider],
  );

  // Mode-specific post-processing: the model's raw text → the form each surface uses
  // (slides → engine Markdown, slide → fenced Markdown, diagram-edit → validated YAML).
  // Returns either a result or a human error — same outcomes as before, centralised so
  // every task path (foreground + loop) treats responses identically.
  const postProcess = useCallback((mode: AiMode, raw: string): { result?: string; error?: string } => {
    if (mode === "slides") {
      const parsed = extractDeckPlan(raw);
      return parsed.ok ? { result: serializeMd(deckPlanToDeck(parsed.plan)) } : { error: `Couldn't read the generated plan: ${parsed.error}` };
    }
    if (mode === "slide" || mode === "condense") {
      const md = stripMarkdownFence(raw);
      return md ? { result: md } : { error: "Couldn't read the edited slide (empty response)." };
    }
    if (mode === "diagram-edit") {
      const r = parseJsonLoose(raw);
      if (!r.ok) return { error: "Couldn't find a diagram in the response." };
      const parsed = DiagramSpecSchema.safeParse(r.value);
      return parsed.success ? { result: diagramSpecToYaml(parsed.data) } : { error: `Invalid diagram: ${parsed.error.issues[0]?.message}` };
    }
    return { result: raw }; // "diagram" → raw passthrough (unchanged from before)
  }, []);

  const patchTask = useCallback((id: string, patch: Partial<AiTask>) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const enqueue = useCallback((prompt: string, mode: AiMode, label: string): AiTask => {
    const task: AiTask = { id: `t${++idCounter.current}`, docId: activeDocIdRef.current, mode, label, prompt, status: "running", result: "", startedAt: Date.now() };
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
        const raw = await generateWithAI({
          provider, apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model,
          mode: task.mode, userRequest: task.prompt,
          onText: (t) => patchTask(task.id, { result: t }),
          signal: controller.signal,
          localOnly: localModelOnly, // hard egress block at the chokepoint
        });
        const pp = postProcess(task.mode, raw);
        if (pp.error) {
          patchTask(task.id, { status: "error", error: pp.error, finishedAt: Date.now() });
          throw new Error(pp.error);
        }
        patchTask(task.id, { status: "done", result: pp.result ?? "", finishedAt: Date.now() });
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
    if (rememberKey) localStorage.setItem(AI_CONFIG_STORAGE, JSON.stringify({ provider, configs }));
    else localStorage.removeItem(AI_CONFIG_STORAGE);
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
    (userRequest: string, mode: AiMode) => {
      if (!canGenerate(userRequest)) return;
      persistConfig();
      const task = enqueue(userRequest, mode, MODE_LABEL[mode]);
      setActiveTaskId(task.id);
      void runTask(task).catch(() => {});
    },
    [canGenerate, persistConfig, enqueue, runTask],
  );

  const cancel = useCallback(() => {
    if (activeTaskId) abortMap.current.get(activeTaskId)?.abort();
  }, [activeTaskId]);
  const cancelTask = useCallback((id: string) => abortMap.current.get(id)?.abort(), []);
  const clearTasks = useCallback(() => {
    setTasks((ts) => ts.filter((t) => t.status === "running")); // keep in-flight, drop history
  }, []);

  // Hide the foreground result/diff (e.g. after apply) without losing it from history.
  const reset = useCallback(() => setActiveTaskId(null), []);
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

  // A human-readable connection status for the CURRENT provider + an actionable
  // hint when it isn't ready — so the user knows exactly what to fix.
  const connection: { ok: boolean; tone: "ok" | "warn" | "err" | "checking"; label: string; hint?: string } = (() => {
    const isOllama = provider === "ollama";
    if (preset.native) {
      if (preset.keyRequired && !cfg.apiKey.trim()) return { ok: false, tone: "warn", label: "APIキー未設定", hint: "下の設定に Anthropic の API キーを入力" };
      if (!cfg.model.trim()) return { ok: false, tone: "warn", label: "モデル未選択" };
      return { ok: true, tone: "ok", label: `${cfg.model} を使用` };
    }
    if (!cfg.baseURL.trim()) return { ok: false, tone: "warn", label: "Base URL 未設定" };
    if (modelsLoading) return { ok: false, tone: "checking", label: "接続を確認中…" };
    if (modelsError) {
      return isOllama
        ? { ok: false, tone: "err", label: "Ollama に接続できません", hint: "`ollama serve` で起動（既定 localhost:11434）" }
        : { ok: false, tone: "err", label: "接続できません", hint: `エンドポイントを確認（${modelsError}）` };
    }
    if (models.length === 0) {
      return { ok: false, tone: "warn", label: "利用可能なモデルがありません", hint: isOllama ? "`ollama pull qwen2.5` 等でモデルを取得" : "モデル名を確認" };
    }
    if (preset.keyRequired && !cfg.apiKey.trim()) return { ok: false, tone: "warn", label: "APIキー未設定" };
    if (!cfg.model.trim() || !models.includes(cfg.model)) return { ok: false, tone: "warn", label: "モデルを選択", hint: `${models.length} 個のモデルが利用可` };
    return { ok: true, tone: "ok", label: `${cfg.model}（接続OK・${models.length} モデル）` };
  })();

  // Only the active document's tasks are surfaced (history is partitioned per project).
  const docTasks = tasks.filter((t) => t.docId === activeDocId);

  return {
    provider, setProvider,
    configs, cfg, preset, setField,
    rememberKey, setRememberKey,
    generating, result, setResult, error,
    canGenerate, generate, cancel, reset,
    tasks: docTasks, setActiveDocId, submit, submitAndWait, cancelTask, clearTasks,
    models, modelsError, modelsLoading, refreshModels,
    ollamaModels, switchToOllama, connection,
    localModelOnly, setLocalModelOnly, localBlocked,
  };
}

/** The shared AI generation instance. Lifted to App and passed to every AI surface
 *  (AiPanel, LlmAssist) + the refine loop so provider/key config never diverges. */
export type AiGeneration = ReturnType<typeof useAiGeneration>;
