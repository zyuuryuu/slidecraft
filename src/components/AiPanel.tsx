/**
 * AiPanel.tsx — In-Edit AI dock.
 *
 * An immersive, always-at-hand AI surface for Edit mode: describe a deck →
 * generate (streamed) → apply, without leaving the editor. Shares all
 * generation logic with the AI dialog via useAiGeneration (no divergence).
 */

import { useState } from "react";
import { PROVIDERS } from "../ipc/ai";
import { useAiGeneration } from "./useAiGeneration";

interface AiPanelProps {
  onApply: (markdown: string) => void;
  onClose: () => void;
}

export default function AiPanel({ onApply, onClose }: AiPanelProps) {
  const ai = useAiGeneration();
  const [userRequest, setUserRequest] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const ready = ai.canGenerate(userRequest);
  const field = "px-2 py-1 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-xs text-white";

  return (
    <div className="border-t border-[#3B82F6]/40 bg-[#0a0e1a] flex flex-col shrink-0" style={{ maxHeight: 340 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#2D3A6E]">
        <span className="text-sm text-[#93C5FD] font-medium">✨ AI Assist</span>
        <select
          value={ai.provider}
          onChange={(e) => ai.setProvider(e.target.value as typeof ai.provider)}
          className={field}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="text-xs text-gray-400 hover:text-white px-1.5 py-1 rounded hover:bg-[#2D3A6E]"
          title="プロバイダ設定"
        >
          ⚙ 設定
        </button>
        <div className="flex-1" />
        <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none" title="閉じる">
          ×
        </button>
      </div>

      {/* Settings */}
      {showSettings && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[#2D3A6E] bg-[#0f1117]">
          {!ai.preset.native && (
            <input
              className={`${field} w-56`}
              placeholder="Base URL"
              value={ai.cfg.baseURL}
              onChange={(e) => ai.setField("baseURL", e.target.value)}
            />
          )}
          <input
            className={`${field} w-40`}
            placeholder="model"
            value={ai.cfg.model}
            onChange={(e) => ai.setField("model", e.target.value)}
          />
          <input
            className={`${field} w-56`}
            type="password"
            placeholder={ai.preset.keyRequired ? "API key" : "API key (任意)"}
            value={ai.cfg.apiKey}
            onChange={(e) => ai.setField("apiKey", e.target.value)}
          />
          <label className="flex items-center gap-1 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={ai.rememberKey}
              onChange={(e) => ai.setRememberKey(e.target.checked)}
            />
            キーを記憶
          </label>
        </div>
      )}

      {/* Prompt */}
      <div className="flex gap-2 px-3 py-2">
        <textarea
          value={userRequest}
          onChange={(e) => setUserRequest(e.target.value)}
          rows={2}
          placeholder="作りたいスライドを指示（例: SaaS の営業提案を5枚で。課題→解決→価格→導入事例→次のステップ）"
          className="flex-1 px-2 py-1.5 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-white resize-none"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && ready) ai.generate(userRequest, "slides");
          }}
        />
        {ai.generating ? (
          <button onClick={ai.cancel} className="px-4 text-sm bg-[#2D3A6E] hover:bg-[#3B82F6]/40 text-white rounded shrink-0">
            停止
          </button>
        ) : (
          <button
            onClick={() => ai.generate(userRequest, "slides")}
            disabled={!ready}
            className="px-4 text-sm bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#3B82F6]/30 disabled:text-white/40 text-white font-medium rounded shrink-0"
          >
            {ai.generating ? "生成中…" : "生成"}
          </button>
        )}
      </div>

      {/* Error */}
      {ai.error && (
        <div className="mx-3 mb-2 px-2 py-1.5 bg-red-900/30 border border-red-500/40 rounded text-xs text-red-300">
          {ai.error}
        </div>
      )}

      {/* Result + apply */}
      {ai.result && (
        <div className="flex flex-col min-h-0 border-t border-[#2D3A6E]">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs text-gray-400">{ai.generating ? "生成中…" : "プレビュー（Markdown）"}</span>
            <button
              onClick={() => onApply(ai.result)}
              disabled={ai.generating || !ai.result.trim()}
              className="px-3 py-1 text-xs bg-[#06B6D4] hover:bg-[#0891B2] disabled:opacity-40 text-white font-medium rounded"
            >
              適用 → 編集へ
            </button>
          </div>
          <pre className="overflow-auto px-3 pb-2 text-[11px] text-green-200 font-mono whitespace-pre-wrap" style={{ maxHeight: 150 }}>
            {ai.result}
          </pre>
        </div>
      )}
    </div>
  );
}
