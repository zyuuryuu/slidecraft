/**
 * LlmAssist.tsx — AI Assist dialog.
 *
 * Primary flow: describe a request → generate slide Markdown / diagram JSON
 * directly with Claude (BYOK), streamed live → import into SlideCraft.
 * Fallback flow: copy the generated prompt to any LLM and paste the result back.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { generateCombinedPrompt } from "../engine/llm-prompts";
import { generateWithClaude } from "../ipc/claude";

interface LlmAssistProps {
  isOpen: boolean;
  onClose: () => void;
  onImportResult: (text: string) => void;
}

const API_KEY_STORAGE = "slidecraft_anthropic_api_key";

export default function LlmAssist({ isOpen, onClose, onImportResult }: LlmAssistProps) {
  const [mode, setMode] = useState<"slides" | "diagram">("slides");
  const [userRequest, setUserRequest] = useState("");
  const [llmResult, setLlmResult] = useState("");

  // BYOK API key
  const [apiKey, setApiKey] = useState("");
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

  // Load a saved key when the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    const saved = localStorage.getItem(API_KEY_STORAGE);
    if (saved) {
      setApiKey(saved);
      setRememberKey(true);
    }
  }, [isOpen]);

  const handleGenerate = useCallback(async () => {
    if (!userRequest.trim() || !apiKey.trim() || generating) return;

    if (rememberKey) localStorage.setItem(API_KEY_STORAGE, apiKey.trim());
    else localStorage.removeItem(API_KEY_STORAGE);

    setError(null);
    setLlmResult("");
    setGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await generateWithClaude({
        apiKey,
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
  }, [userRequest, apiKey, rememberKey, generating, mode]);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#0f1117] border border-[#2D3A6E] rounded-lg w-[800px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2D3A6E]">
          <h2 className="text-white font-semibold">AI Assist — Generate with Claude</h2>
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
              className="w-full px-3 py-2 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-white"
              placeholder={mode === "slides"
                ? "例: CRM移行プロジェクトの進捗報告（10枚程度、現状分析・比較・ロードマップを含む）"
                : "例: 3層Webアプリのネットワーク構成図（LB→Web→App→DB、DMZあり）"
              }
            />
          </div>

          {/* API key (BYOK) */}
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider">
              2. Your Claude API key
            </label>
            <div className="flex gap-2 mt-1 items-center">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="flex-1 px-3 py-2 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-white font-mono"
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
            <label className="flex items-center gap-2 mt-2 text-xs text-gray-400">
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
                disabled={!userRequest.trim() || !apiKey.trim()}
                className="px-4 py-1.5 text-sm bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#3B82F6]/30 text-white rounded"
              >
                Generate with Claude
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
              {showManual ? "Hide manual copy/paste" : "No key? Copy the prompt instead"}
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
              className="w-full mt-1 px-3 py-2 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-white font-mono"
              placeholder="Generated Markdown / JSON appears here as Claude writes it…"
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
