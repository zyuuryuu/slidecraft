/**
 * LlmAssist.tsx — AI Assist dialog.
 *
 * Primary flow: describe a request → generate slide Markdown / diagram JSON
 * directly with the selected AI provider (BYOK), streamed live → import.
 * Providers: Claude (native) + any OpenAI-compatible endpoint
 * (OpenAI / OpenRouter / Ollama / custom). Fallback: copy prompt to any LLM.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { generateCombinedPrompt } from "../engine/llm-prompts";
import {
  generateWithAI,
  PROVIDERS,
  providerPreset,
  type ProviderId,
} from "../ipc/ai";

interface LlmAssistProps {
  isOpen: boolean;
  onClose: () => void;
  onImportResult: (text: string) => void;
}

const CONFIG_STORAGE = "slidecraft_ai_config";

interface ProviderConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}
type ConfigMap = Record<ProviderId, ProviderConfig>;

function defaultConfigs(): ConfigMap {
  const out = {} as ConfigMap;
  for (const p of PROVIDERS) {
    out[p.id] = { baseURL: p.baseURL, model: p.model, apiKey: "" };
  }
  return out;
}

export default function LlmAssist({ isOpen, onClose, onImportResult }: LlmAssistProps) {
  const [mode, setMode] = useState<"slides" | "diagram">("slides");
  const [userRequest, setUserRequest] = useState("");
  const [llmResult, setLlmResult] = useState("");

  // Provider + per-provider config (BYOK)
  const [provider, setProvider] = useState<ProviderId>("claude");
  const [configs, setConfigs] = useState<ConfigMap>(defaultConfigs);
  const [rememberKey, setRememberKey] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // Direct generation state
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Manual copy/paste fallback
  const [showManual, setShowManual] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);

  // Load saved provider + configs when the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE);
      if (!raw) return;
      const saved = JSON.parse(raw) as { provider?: ProviderId; configs?: Partial<ConfigMap> };
      if (saved.provider) setProvider(saved.provider);
      if (saved.configs) {
        setConfigs((cur) => ({ ...cur, ...saved.configs }));
        setRememberKey(true);
      }
    } catch {
      // ignore corrupt config
    }
  }, [isOpen]);

  const preset = providerPreset(provider);
  const cfg = configs[provider];
  const setField = useCallback(
    (key: keyof ProviderConfig, value: string) => {
      setConfigs((c) => ({ ...c, [provider]: { ...c[provider], [key]: value } }));
    },
    [provider],
  );

  const canGenerate =
    userRequest.trim().length > 0 &&
    cfg.model.trim().length > 0 &&
    (preset.native || cfg.baseURL.trim().length > 0) &&
    (!preset.keyRequired || cfg.apiKey.trim().length > 0);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate || generating) return;

    if (rememberKey) {
      localStorage.setItem(CONFIG_STORAGE, JSON.stringify({ provider, configs }));
    } else {
      localStorage.removeItem(CONFIG_STORAGE);
    }

    setError(null);
    setLlmResult("");
    setGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await generateWithAI({
        provider,
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL,
        model: cfg.model,
        mode,
        userRequest,
        onText: setLlmResult,
        signal: controller.signal,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [canGenerate, generating, rememberKey, provider, configs, cfg, mode, userRequest]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleGeneratePrompt = useCallback(() => {
    if (!userRequest.trim()) return;
    setPrompt(generateCombinedPrompt(mode, userRequest));
    setCopied(false);
  }, [mode, userRequest]);

  const handleCopyPrompt = useCallback(async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [prompt]);

  const handleImport = useCallback(() => {
    if (!llmResult.trim()) return;
    onImportResult(llmResult);
    onClose();
  }, [llmResult, onImportResult, onClose]);

  if (!isOpen) return null;

  const fieldClass =
    "w-full px-3 py-2 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-white";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#0f1117] border border-[#2D3A6E] rounded-lg w-[800px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2D3A6E]">
          <h2 className="text-white font-semibold">AI Assist — Generate with AI</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
          {/* Step 1: User request */}
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider">
              1. What do you want to create?
            </label>
            <div className="flex gap-2 mt-1 mb-2">
              <button
                onClick={() => setMode("slides")}
                className={`px-3 py-1 text-xs rounded ${
                  mode === "slides" ? "bg-[#3B82F6] text-white" : "bg-[#1a1f3a] text-gray-400"
                }`}
              >
                Slide Deck
              </button>
              <button
                onClick={() => setMode("diagram")}
                className={`px-3 py-1 text-xs rounded ${
                  mode === "diagram" ? "bg-[#3B82F6] text-white" : "bg-[#1a1f3a] text-gray-400"
                }`}
              >
                Diagram
              </button>
            </div>
            <textarea
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              rows={3}
              className={fieldClass}
              placeholder={mode === "slides"
                ? "例: CRM移行プロジェクトの進捗報告（10枚程度、現状分析・比較・ロードマップを含む）"
                : "例: 3層Webアプリのネットワーク構成図（LB→Web→App→DB、DMZあり）"
              }
            />
          </div>

          {/* Step 2: Provider & connection (BYOK) */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-400 uppercase tracking-wider">
              2. AI provider
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderId)}
              className={fieldClass}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>

            {!preset.native && (
              <input
                type="text"
                value={cfg.baseURL}
                onChange={(e) => setField("baseURL", e.target.value)}
                placeholder="Base URL (e.g. https://api.openai.com/v1)"
                className={`${fieldClass} font-mono text-xs`}
                autoComplete="off"
              />
            )}

            <input
              type="text"
              value={cfg.model}
              onChange={(e) => setField("model", e.target.value)}
              placeholder={preset.native ? "claude-opus-4-8" : "Model name (e.g. gpt-4o)"}
              className={`${fieldClass} font-mono text-xs`}
              autoComplete="off"
            />

            <div className="flex gap-2 items-center">
              <input
                type={showKey ? "text" : "password"}
                value={cfg.apiKey}
                onChange={(e) => setField("apiKey", e.target.value)}
                placeholder={preset.keyRequired ? "API key" : "API key (optional for local)"}
                className={`${fieldClass} font-mono`}
                autoComplete="off"
              />
              <button
                onClick={() => setShowKey((s) => !s)}
                className="px-2 py-2 text-xs bg-[#2D3A6E] text-gray-200 rounded"
                type="button"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(e) => setRememberKey(e.target.checked)}
              />
              Remember on this device (stored locally)
            </label>
          </div>

          {/* Generate */}
          <div className="flex items-center gap-3">
            {generating ? (
              <button
                onClick={handleCancel}
                className="px-4 py-1.5 text-sm bg-[#C0504D] hover:bg-[#a83f3c] text-white rounded"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="px-4 py-1.5 text-sm bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#3B82F6]/30 text-white rounded"
              >
                Generate
              </button>
            )}
            {generating && (
              <span className="text-xs text-[#06B6D4] animate-pulse">Generating…</span>
            )}
            <button
              onClick={() => setShowManual((s) => !s)}
              className="ml-auto text-xs text-gray-500 hover:text-gray-300 underline"
              type="button"
            >
              {showManual ? "Hide manual copy/paste" : "Or copy the prompt instead"}
            </button>
          </div>

          {error && (
            <div className="text-xs text-[#F87171] bg-[#C0504D]/10 border border-[#C0504D]/40 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Manual fallback: copy prompt to any LLM */}
          {showManual && (
            <div className="border border-[#2D3A6E] rounded p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400 uppercase tracking-wider">
                  Manual — copy this prompt to your LLM
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleGeneratePrompt}
                    disabled={!userRequest.trim()}
                    className="px-3 py-1 text-xs bg-[#2D3A6E] hover:bg-[#3B82F6]/40 disabled:opacity-40 text-white rounded"
                  >
                    Build Prompt
                  </button>
                  {prompt && (
                    <button
                      onClick={handleCopyPrompt}
                      className="px-3 py-1 text-xs bg-[#2D3A6E] hover:bg-[#3B82F6]/40 text-white rounded"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  )}
                </div>
              </div>
              {prompt && (
                <textarea
                  value={prompt}
                  readOnly
                  rows={6}
                  className="w-full px-3 py-2 bg-[#141B41] border border-[#2D3A6E] rounded text-xs text-gray-300 font-mono"
                />
              )}
            </div>
          )}

          {/* Result */}
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider">
              3. Result {showManual && "(or paste your LLM's response here)"}
            </label>
            <textarea
              value={llmResult}
              onChange={(e) => setLlmResult(e.target.value)}
              rows={10}
              className={`${fieldClass} mt-1 font-mono`}
              placeholder="Generated Markdown / JSON appears here as the AI writes it…"
            />
            <button
              onClick={handleImport}
              disabled={!llmResult.trim() || generating}
              className="mt-2 px-4 py-1.5 text-sm bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#3B82F6]/30 text-white rounded"
            >
              Import to SlideCraft
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
