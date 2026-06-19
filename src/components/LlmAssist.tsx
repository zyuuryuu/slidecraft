/**
 * LlmAssist.tsx — AI Assist dialog (used from Import mode).
 *
 * Primary flow: describe a request → generate slide Markdown / diagram JSON
 * directly with the selected AI provider (BYOK), streamed live → import.
 * Providers: Claude (native) + any OpenAI-compatible endpoint
 * (OpenAI / OpenRouter / Ollama / custom). Fallback: copy prompt to any LLM.
 *
 * Generation logic is shared with the in-Edit Ai dock via useAiGeneration, so
 * the two surfaces never diverge.
 */

import { useState, useCallback } from "react";
import { generateCombinedPrompt } from "../engine/llm-prompts";
import { PROVIDERS, type ProviderId } from "../ipc/ai";
import { useAiGeneration } from "./useAiGeneration";

interface LlmAssistProps {
  isOpen: boolean;
  onClose: () => void;
  onImportResult: (text: string) => void;
}

export default function LlmAssist({ isOpen, onClose, onImportResult }: LlmAssistProps) {
  const ai = useAiGeneration();
  // The dialog only offers whole-deck or diagram generation (not single-slide).
  const [mode, setMode] = useState<"slides" | "diagram">("slides");
  const [userRequest, setUserRequest] = useState("");

  // Show/hide API key + manual copy/paste fallback (UI-only state).
  const [showKey, setShowKey] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);

  const canGenerate = ai.canGenerate(userRequest);

  const handleGenerate = useCallback(() => ai.generate(userRequest, mode), [ai, userRequest, mode]);

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
    if (!ai.result.trim()) return;
    onImportResult(ai.result);
    onClose();
  }, [ai.result, onImportResult, onClose]);

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
              value={ai.provider}
              onChange={(e) => ai.setProvider(e.target.value as ProviderId)}
              className={fieldClass}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>

            {!ai.preset.native && (
              <input
                type="text"
                value={ai.cfg.baseURL}
                onChange={(e) => ai.setField("baseURL", e.target.value)}
                placeholder="Base URL (e.g. https://api.openai.com/v1)"
                className={`${fieldClass} font-mono text-xs`}
                autoComplete="off"
              />
            )}

            <input
              type="text"
              value={ai.cfg.model}
              onChange={(e) => ai.setField("model", e.target.value)}
              placeholder={ai.preset.native ? "claude-opus-4-8" : "Model name (e.g. gpt-4o)"}
              className={`${fieldClass} font-mono text-xs`}
              autoComplete="off"
            />

            <div className="flex gap-2 items-center">
              <input
                type={showKey ? "text" : "password"}
                value={ai.cfg.apiKey}
                onChange={(e) => ai.setField("apiKey", e.target.value)}
                placeholder={ai.preset.keyRequired ? "API key" : "API key (optional for local)"}
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
                checked={ai.rememberKey}
                onChange={(e) => ai.setRememberKey(e.target.checked)}
              />
              Remember on this device (stored locally)
            </label>
          </div>

          {/* Generate */}
          <div className="flex items-center gap-3">
            {ai.generating ? (
              <button
                onClick={ai.cancel}
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
            {ai.generating && (
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

          {ai.error && (
            <div className="text-xs text-[#F87171] bg-[#C0504D]/10 border border-[#C0504D]/40 rounded px-3 py-2">
              {ai.error}
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
              value={ai.result}
              onChange={(e) => ai.setResult(e.target.value)}
              rows={10}
              className={`${fieldClass} mt-1 font-mono`}
              placeholder="Generated Markdown / JSON appears here as the AI writes it…"
            />
            <button
              onClick={handleImport}
              disabled={!ai.result.trim() || ai.generating}
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
