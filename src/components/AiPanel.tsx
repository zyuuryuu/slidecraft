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
  /** Markdown of the active slide — enables the token-cheap "this slide" scope. */
  currentSlideMd?: string;
  /** Apply an edited single slide back to the active slide only. */
  onApplySlide?: (markdown: string) => void;
  /** Template capability summary prepended to whole-deck generation. */
  templateHint?: string;
}

export default function AiPanel({
  onApply,
  onClose,
  currentSlideMd,
  onApplySlide,
  templateHint,
}: AiPanelProps) {
  const ai = useAiGeneration();
  const [userRequest, setUserRequest] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const canSlide = !!currentSlideMd && !!onApplySlide;
  // "このスライド" edits the WHOLE slide as Markdown (text + any figure together) —
  // it covers diagram editing too, so there's no separate "図表" scope. Falls back
  // to whole-deck when no single slide is active.
  const [scope, setScope] = useState<"deck" | "slide">("slide");
  const eff = scope === "slide" && !canSlide ? "deck" : scope;
  const slideScope = eff === "slide";

  const ready = ai.canGenerate(userRequest);
  const field = "px-2 py-1 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-xs text-white";

  const doGenerate = () => {
    if (slideScope && currentSlideMd) {
      // One slide in, one slide out (text + any figure) — far fewer tokens than the deck.
      ai.generate(`Current slide:\n${currentSlideMd}\n\nInstruction: ${userRequest}`, "slide");
    } else {
      // Whole-deck generation gets the template's capabilities (kinds/columns/capacity).
      ai.generate(templateHint ? `${templateHint}\n\n${userRequest}` : userRequest, "slides");
    }
  };

  const doApply = () => {
    if (slideScope && onApplySlide) onApplySlide(ai.result);
    else onApply(ai.result);
  };

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

      {/* Connection status + local-Ollama auto-detect (setup assist) */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-[#2D3A6E] text-[11px]">
        <span
          className={
            ai.connection.tone === "ok"
              ? "text-green-400"
              : ai.connection.tone === "err"
                ? "text-red-400"
                : ai.connection.tone === "checking"
                  ? "text-gray-400"
                  : "text-amber-400"
          }
        >
          ●
        </span>
        <span className="text-gray-300">{ai.connection.label}</span>
        {ai.connection.hint && <span className="text-gray-500 truncate">— {ai.connection.hint}</span>}
        <div className="flex-1" />
        {!ai.connection.ok && (
          <button onClick={() => setShowSettings(true)} className="text-[#93C5FD] hover:underline shrink-0">
            設定を開く
          </button>
        )}
        {ai.ollamaModels && ai.ollamaModels.length > 0 && ai.provider !== "ollama" && (
          <button
            onClick={ai.switchToOllama}
            className="px-2 py-0.5 rounded bg-[#1a1f3a] text-[#93C5FD] hover:bg-[#2D3A6E] border border-[#2D3A6E] shrink-0"
            title="ローカルの Ollama に切り替え"
          >
            🦙 Ollama検出（{ai.ollamaModels.length}）→ 使う
          </button>
        )}
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
          {ai.models.length > 0 ? (
            <select
              className={`${field} w-44`}
              value={ai.cfg.model}
              onChange={(e) => ai.setField("model", e.target.value)}
            >
              {ai.cfg.model && !ai.models.includes(ai.cfg.model) && (
                <option value={ai.cfg.model}>{ai.cfg.model}（未インストール）</option>
              )}
              {ai.models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              className={`${field} w-40`}
              placeholder="model"
              value={ai.cfg.model}
              onChange={(e) => ai.setField("model", e.target.value)}
            />
          )}
          <button
            onClick={ai.refreshModels}
            type="button"
            title="インストール済みモデルを取得"
            className={`${field} hover:bg-[#2D3A6E]`}
          >
            ↻
          </button>
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

      {/* Scope + Prompt */}
      <div className="px-3 py-2 flex flex-col gap-2">
        {canSlide && (
          <div className="flex items-center gap-1 text-xs flex-wrap">
            <span className="text-gray-500 mr-1">対象:</span>
            <button
              onClick={() => setScope("slide")}
              className={`px-2 py-0.5 rounded ${eff === "slide" ? "bg-[#3B82F6] text-white" : "bg-[#1a1f3a] text-gray-400"}`}
            >
              このスライド
            </button>
            <button
              onClick={() => setScope("deck")}
              className={`px-2 py-0.5 rounded ${eff === "deck" ? "bg-[#3B82F6] text-white" : "bg-[#1a1f3a] text-gray-400"}`}
            >
              デッキ全体
            </button>
            {slideScope && (
              <span className="text-gray-500 ml-1">— このスライドだけ送って編集（トークン節約）</span>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            rows={2}
            placeholder={
              slideScope
                ? "このスライドへの指示（例: 箇条書きを3つに / もっと簡潔に / 図を追加 / DBノードを足す / 英語にする）"
                : "作りたいデッキを指示（例: SaaS の営業提案を5枚で。課題→解決→価格→導入事例→次のステップ）"
            }
            className="flex-1 px-2 py-1.5 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-white resize-none"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && ready) doGenerate();
            }}
          />
          {ai.generating ? (
            <button onClick={ai.cancel} className="px-4 text-sm bg-[#2D3A6E] hover:bg-[#3B82F6]/40 text-white rounded shrink-0">
              停止
            </button>
          ) : (
            <button
              onClick={doGenerate}
              disabled={!ready}
              className="px-4 text-sm bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#3B82F6]/30 disabled:text-white/40 text-white font-medium rounded shrink-0"
            >
              生成
            </button>
          )}
        </div>
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
            <span className="text-xs text-gray-400">
              {ai.generating ? "生成中…" : "プレビュー（Markdown）"}
            </span>
            <button
              onClick={doApply}
              disabled={ai.generating || !ai.result.trim()}
              className="px-3 py-1 text-xs bg-[#06B6D4] hover:bg-[#0891B2] disabled:opacity-40 text-white font-medium rounded"
            >
              {slideScope ? "適用 → このスライド" : "適用 → 編集へ"}
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
