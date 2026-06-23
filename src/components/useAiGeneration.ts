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
import { generateWithAI, listProviderModels, PROVIDERS, providerPreset, type ProviderId } from "../ipc/ai";

export const AI_CONFIG_STORAGE = "slidecraft_ai_config";

export interface AiProviderConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}
export type AiConfigMap = Record<ProviderId, AiProviderConfig>;
export type AiMode = "slides" | "slide" | "diagram" | "diagram-edit";

function defaultConfigs(): AiConfigMap {
  const out = {} as AiConfigMap;
  for (const p of PROVIDERS) {
    out[p.id] = { baseURL: p.baseURL, model: p.model, apiKey: "" };
  }
  return out;
}

export function useAiGeneration() {
  const [provider, setProvider] = useState<ProviderId>("claude");
  const [configs, setConfigs] = useState<AiConfigMap>(defaultConfigs);
  const [rememberKey, setRememberKey] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Setup-assist state: local Ollama probe (null = not yet checked) + once-flags.
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const hadSavedConfig = useRef(false);
  const didAutoSelect = useRef(false);

  // Load saved provider + configs once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AI_CONFIG_STORAGE);
      if (!raw) return;
      hadSavedConfig.current = true; // user has configured before → don't auto-pick a provider
      const saved = JSON.parse(raw) as { provider?: ProviderId; configs?: Partial<AiConfigMap> };
      if (saved.provider) setProvider(saved.provider);
      if (saved.configs) {
        setConfigs((cur) => ({ ...cur, ...saved.configs }));
        setRememberKey(true);
      }
    } catch {
      /* ignore corrupt config */
    }
  }, []);

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
      (!preset.keyRequired || cfg.apiKey.trim().length > 0),
    [cfg, preset],
  );

  const generate = useCallback(
    async (userRequest: string, mode: AiMode) => {
      if (!canGenerate(userRequest) || generating) return;

      if (rememberKey) {
        localStorage.setItem(AI_CONFIG_STORAGE, JSON.stringify({ provider, configs }));
      } else {
        localStorage.removeItem(AI_CONFIG_STORAGE);
      }

      setError(null);
      setResult("");
      setGenerating(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const raw = await generateWithAI({
          provider,
          apiKey: cfg.apiKey,
          baseURL: cfg.baseURL,
          model: cfg.model,
          mode,
          userRequest,
          onText: setResult,
          signal: controller.signal,
        });
        // Slides come back as a DeckPlan JSON; the engine turns it into correct
        // SlideCraft Markdown (right layouts/placeholders) for import + editing.
        if (mode === "slides") {
          const parsed = extractDeckPlan(raw);
          if (parsed.ok) {
            setResult(serializeMd(deckPlanToDeck(parsed.plan)));
          } else {
            setError(`Couldn't read the generated plan: ${parsed.error}`);
          }
        } else if (mode === "slide") {
          // Whole-slide Markdown round-trip: the model returns the edited slide's
          // Markdown (text + any ```diagram/```mermaid block); parseMd turns it back
          // into a slide on apply, so one edit can revise text AND figure together.
          const md = stripMarkdownFence(raw);
          if (md) setResult(md);
          else setError("Couldn't read the edited slide (empty response).");
        } else if (mode === "diagram-edit") {
          // AI returns the updated DiagramSpec JSON → validate → back to YAML.
          const r = parseJsonLoose(raw);
          if (!r.ok) {
            setError("Couldn't find a diagram in the response.");
          } else {
            const parsed = DiagramSpecSchema.safeParse(r.value);
            if (parsed.success) setResult(diagramSpecToYaml(parsed.data));
            else setError(`Invalid diagram: ${parsed.error.issues[0]?.message}`);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setGenerating(false);
        abortRef.current = null;
      }
    },
    [canGenerate, generating, rememberKey, provider, configs, cfg],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    setResult("");
    setError(null);
  }, []);

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

  return {
    provider, setProvider,
    configs, cfg, preset, setField,
    rememberKey, setRememberKey,
    generating, result, setResult, error,
    canGenerate, generate, cancel, reset,
    models, modelsError, modelsLoading, refreshModels,
    ollamaModels, switchToOllama, connection,
  };
}
