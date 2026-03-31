/**
 * LlmAssist.tsx — LLM prompt generation dialog.
 *
 * User types a request, selects mode (slides/diagram),
 * and gets a formatted prompt to copy to their LLM of choice.
 */

import { useState, useCallback } from "react";
import { generateCombinedPrompt } from "../engine/llm-prompts";

interface LlmAssistProps {
  isOpen: boolean;
  onClose: () => void;
  onImportResult: (text: string) => void;
}

export default function LlmAssist({ isOpen, onClose, onImportResult }: LlmAssistProps) {
  const [mode, setMode] = useState<"slides" | "diagram">("slides");
  const [userRequest, setUserRequest] = useState("");
  const [prompt, setPrompt] = useState("");
  const [llmResult, setLlmResult] = useState("");
  const [copied, setCopied] = useState(false);

  const handleGeneratePrompt = useCallback(() => {
    if (!userRequest.trim()) return;
    const p = generateCombinedPrompt(mode, userRequest);
    setPrompt(p);
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
          <h2 className="text-white font-semibold">AI Assist — LLM Prompt Generator</h2>
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
            <button
              onClick={handleGeneratePrompt}
              disabled={!userRequest.trim()}
              className="mt-2 px-4 py-1.5 text-sm bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#3B82F6]/30 text-white rounded"
            >
              Generate Prompt
            </button>
          </div>

          {/* Step 2: Generated prompt */}
          {prompt && (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400 uppercase tracking-wider">
                  2. Copy this prompt to your LLM
                </label>
                <button
                  onClick={handleCopyPrompt}
                  className="px-3 py-1 text-xs bg-[#2D3A6E] hover:bg-[#3B82F6]/40 text-white rounded"
                >
                  {copied ? "Copied!" : "Copy to Clipboard"}
                </button>
              </div>
              <textarea
                value={prompt}
                readOnly
                rows={8}
                className="w-full mt-1 px-3 py-2 bg-[#141B41] border border-[#2D3A6E] rounded text-xs text-gray-300 font-mono"
              />
            </div>
          )}

          {/* Step 3: Paste LLM result */}
          {prompt && (
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider">
                3. Paste the LLM's response here
              </label>
              <textarea
                value={llmResult}
                onChange={(e) => setLlmResult(e.target.value)}
                rows={8}
                className="w-full mt-1 px-3 py-2 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-white font-mono"
                placeholder="Paste the Markdown or JSON output from your LLM here..."
              />
              <button
                onClick={handleImport}
                disabled={!llmResult.trim()}
                className="mt-2 px-4 py-1.5 text-sm bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#3B82F6]/30 text-white rounded"
              >
                Import to SlideCraft
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
