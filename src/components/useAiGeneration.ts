/**
 * useAiGeneration — Shared BYOK generation logic for the AI Assist surfaces.
 *
 * Both the AI dialog (LlmAssist) and the in-Edit AI dock (AiPanel) use this so
 * provider config + generation behaviour can never diverge between them.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { extractDeckPlan, deckPlanToDeck, extractSlidePlan, slidePlanToSlide } from "../engine/deck-plan";
import { serializeMd } from "../engine/md-serializer";
import { generateWithAI, PROVIDERS, providerPreset, type ProviderId } from "../ipc/ai";

export const AI_CONFIG_STORAGE = "slidecraft_ai_config";

export interface AiProviderConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}
export type AiConfigMap = Record<ProviderId, AiProviderConfig>;
export type AiMode = "slides" | "slide" | "diagram";

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

  // Load saved provider + configs once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AI_CONFIG_STORAGE);
      if (!raw) return;
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

  const preset = providerPreset(provider);
  const cfg = configs[provider];

  const setField = useCallback(
    (key: keyof AiProviderConfig, value: string) => {
      setConfigs((c) => ({ ...c, [provider]: { ...c[provider], [key]: value } }));
    },
    [provider],
  );

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
          // One slide in, one slide out → engine renders just that slide's Markdown.
          const parsed = extractSlidePlan(raw);
          if (parsed.ok) {
            setResult(serializeMd({ slides: [slidePlanToSlide(parsed.slide)] }));
          } else {
            setError(`Couldn't read the edited slide: ${parsed.error}`);
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

  return {
    provider, setProvider,
    configs, cfg, preset, setField,
    rememberKey, setRememberKey,
    generating, result, setResult, error,
    canGenerate, generate, cancel, reset,
  };
}
