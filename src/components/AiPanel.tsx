/**
 * AiPanel.tsx — In-Edit AI dock.
 *
 * An immersive, always-at-hand AI surface for Edit mode: describe a deck →
 * generate (streamed) → apply, without leaving the editor. Shares all
 * generation logic with the AI dialog via useAiGeneration (no divergence).
 */

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { PROVIDERS } from "../ipc/ai";
import { runningInTauri } from "../ipc/commands";
import LocalOnlyToggle from "./LocalOnlyToggle";
import type { AiGeneration } from "./useAiGeneration";
import DiffView from "./DiffView";
import AiTasksPanel from "./AiTasksPanel";

const AIPANEL_HEIGHT_KEY = "slidecraft_aipanel_h";

interface AiPanelProps {
  onClose: () => void;
  /** Markdown of the FOCUSED slide — the AI edits this one (scope = slide-list selection). */
  currentSlideMd?: string;
  /** Apply the edited slide back to the focused slide. */
  onApplySlide?: (markdown: string) => void;
  /** Focused slide number (1-based) + how many are selected, for the scope indicator. */
  activeSlideNum?: number;
  selectedCount?: number;
  /** Apply ONE instruction to all selected slides (multi-select batch) → review proposal. */
  onBatchEdit?: (instruction: string) => void;
  batchRunning?: boolean;
  /** Pre-fill the instruction box (ReviewBar "✨直す" handoff). `ts` re-seeds on repeat. */
  seed?: { prompt: string; ts: number };
  /** Shared AI instance (lifted to App) so config never diverges across surfaces. */
  ai: AiGeneration;
  /** The 協働 (live-collab) surface, folded into this hub as a second tab. Omit → no 協働 tab. */
  collabTab?: ReactNode;
  /** Whether a collab session is live (drives the 協働 tab's pulse + the initial tab). */
  collabConnected?: boolean;
}

export default function AiPanel({
  onClose,
  currentSlideMd,
  onApplySlide,
  activeSlideNum,
  selectedCount = 1,
  onBatchEdit,
  batchRunning,
  seed,
  ai,
  collabTab,
  collabConnected,
}: AiPanelProps) {
  const [userRequest, setUserRequest] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<"gen" | "tasks">("gen");
  // Hub-level tab: this dock now houses both the AI assistant and the 協働 (live-collab) surface.
  const [hubTab, setHubTab] = useState<"assist" | "collab">(collabConnected ? "collab" : "assist");
  const runningCount = ai.tasks.filter((t) => t.status === "running").length;

  // Pre-fill the instruction when handed off from the ReviewBar ("✨直す"). Keyed on
  // seed.ts so re-clicking the same issue re-seeds; switches to the gen tab.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional: sync the ReviewBar handoff (seed) into the editable instruction + tab */
  useEffect(() => {
    if (seed) {
      setUserRequest(seed.prompt);
      setTab("gen");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.ts]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Resizable height: drag the top edge to grow the dock upward (persisted). The dock
  // is bottom-anchored, so height = viewport bottom − pointer Y.
  const [panelH, setPanelH] = useState(() => {
    const saved = Number(localStorage.getItem(AIPANEL_HEIGHT_KEY));
    return Number.isFinite(saved) && saved >= 220 ? saved : 340;
  });
  const draggingH = useRef(false);
  useEffect(() => localStorage.setItem(AIPANEL_HEIGHT_KEY, String(Math.round(panelH))), [panelH]);
  const onResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingH.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, []);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingH.current) return;
      setPanelH(Math.min(window.innerHeight - 120, Math.max(220, window.innerHeight - e.clientY)));
    };
    const onUp = () => {
      if (!draggingH.current) return;
      draggingH.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Scope = the slide-list selection. 1 selected → edit the FOCUSED slide here (in-panel
  // diff + 採用). >1 selected → apply the instruction to EACH selected slide (batch) →
  // a review proposal. Whole-deck GENERATION moved to Initialize (📄 → ✨AI生成).
  const batch = selectedCount > 1 && !!onBatchEdit;
  const canSlide = !!currentSlideMd && !!onApplySlide;
  const slideScope = canSlide;

  const ready = ai.canGenerate(userRequest) && !batchRunning && (batch || canSlide);
  const field = "px-2 py-1 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-xs text-white";

  const doGenerate = () => {
    if (batch) { onBatchEdit(userRequest); return; } // one instruction → every selected slide
    if (!currentSlideMd) return;
    // One slide in, one slide out (text + any figure) — far fewer tokens than the deck.
    ai.generate(`Current slide:\n${currentSlideMd}\n\nInstruction: ${userRequest}`, "slide");
  };

  // Diagnostics-driven per-slide fixing lives in the ReviewBar ("まとめて整える") now —
  // this dock is just freeform edit of the focused slide + the task list, kept simple.

  const doApply = () => {
    if (onApplySlide) onApplySlide(ai.result);
  };

  const toneColor =
    ai.connection.tone === "ok" ? "text-green-400"
    : ai.connection.tone === "err" ? "text-red-400"
    : ai.connection.tone === "checking" ? "text-gray-400"
    : "text-amber-400";

  return (
    <div className="border-t border-[#3B82F6]/40 bg-[#0a0e1a] flex flex-col shrink-0" style={{ height: panelH }}>
      {/* Drag the top edge to resize the dock (double-click resets) */}
      <div
        onMouseDown={onResizeDown}
        onDoubleClick={() => setPanelH(340)}
        title="ドラッグで高さ変更（ダブルクリックでリセット）"
        className="h-1.5 shrink-0 cursor-row-resize bg-[#2D3A6E] hover:bg-[#3B82F6] transition-colors"
      />
      {/* Header — hub tabs (アシスト / 協働); gear (config) shows only on the assist tab */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[#2D3A6E]">
        <button
          onClick={() => setHubTab("assist")}
          className={`px-2 py-0.5 rounded text-sm ${hubTab === "assist" ? "bg-[#2D3A6E] text-[#93C5FD] font-medium" : "text-gray-400 hover:text-white"}`}
        >
          ✨ アシスト
        </button>
        {collabTab && (
          <button
            onClick={() => setHubTab("collab")}
            className={`px-2 py-0.5 rounded text-sm inline-flex items-center gap-1 ${hubTab === "collab" ? "bg-[#2D3A6E] text-white font-medium" : "text-gray-400 hover:text-white"}`}
          >
            🔗 協働{collabConnected && <span className="text-emerald-400 leading-none animate-pulse">●</span>}
          </button>
        )}
        <div className="flex-1" />
        {hubTab === "assist" && (
          <button
            onClick={() => setShowSettings((v) => !v)}
            title={`${ai.connection.label}${ai.connection.hint ? " — " + ai.connection.hint : ""}（クリックで設定）`}
            className={`flex items-center gap-1 text-xs px-1.5 py-1 rounded hover:bg-[#2D3A6E] ${showSettings ? "bg-[#2D3A6E] text-white" : "text-gray-400"}`}
          >
            <span className={toneColor}>●</span> ⚙
          </button>
        )}
        <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none" title="閉じる">
          ×
        </button>
      </div>

      {/* Plain-language description of the active tab — so it's obvious what each does (non-IT friendly) */}
      <div className="px-3 py-1.5 text-[11px] text-gray-400 border-b border-[#2D3A6E] bg-[#0f1117] leading-relaxed shrink-0">
        {hubTab === "assist"
          ? "🖊️ AI にお願いして、このアプリの中でスライドを作る・直します。"
          : "🤝 あなたが使っている別の AI（例：Claude Code）をこの画面につなぎ、同じ資料を一緒に編集します。（上級者向け）"}
      </div>

      {hubTab === "collab" ? collabTab : (
      <>
      {/* Settings (folded): connection + provider + Ollama assist, then endpoint/model/key */}
      {showSettings && (
        <div className="flex flex-col gap-2 px-3 py-2 border-b border-[#2D3A6E] bg-[#0f1117]">
          <div className="flex items-center gap-2 text-[11px] flex-wrap">
            <span className={toneColor}>●</span>
            <span className="text-gray-300">{ai.connection.label}</span>
            {ai.connection.hint && <span className="text-gray-500">— {ai.connection.hint}</span>}
            <div className="flex-1" />
            <select
              value={ai.provider}
              onChange={(e) => ai.setProvider(e.target.value as typeof ai.provider)}
              className={field}
            >
              {PROVIDERS.filter((p) => !ai.localModelOnly || p.local || p.id === "custom").map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            {ai.ollamaModels && ai.ollamaModels.length > 0 && ai.provider !== "ollama" && (
              <button
                onClick={ai.switchToOllama}
                className="px-2 py-0.5 rounded bg-[#1a1f3a] text-[#93C5FD] hover:bg-[#2D3A6E] border border-[#2D3A6E]"
                title="ローカルの Ollama に切り替え"
              >
                🦙 Ollama → 使う
              </button>
            )}
            {runningInTauri() &&
              (ai.builtinStatus.kind === "idle" || ai.builtinStatus.kind === "error") &&
              (ai.provider !== "builtin" || ai.weightsPresent === false) && (
                <button
                  onClick={ai.switchToBuiltin}
                  className="px-2 py-0.5 rounded bg-[#1a1f3a] text-[#93C5FD] hover:bg-[#2D3A6E] border border-[#2D3A6E]"
                  title="オフラインの組み込みモデルを使う（初回はモデルを自動ダウンロード）"
                >
                  {ai.weightsPresent === false
                    ? `⬇ ${ai.builtinModel?.display ?? "オフラインAI"}（初回DL ${ai.builtinModel ? (ai.builtinModel.sizeMb / 1024).toFixed(1) : "?"}GB）`
                    : "💻 オフラインAIを使う"}
                </button>
              )}
            {runningInTauri() && ai.builtinStatus.kind === "running" && (
              <button
                onClick={ai.stopBuiltin}
                className="px-2 py-0.5 rounded bg-[#1a1f3a] text-gray-300 hover:bg-[#2D3A6E] border border-[#2D3A6E]"
                title="組み込みAIを停止してメモリを解放（次の生成で自動起動）"
              >
                ⏹ 停止
              </button>
            )}
          </div>
          <LocalOnlyToggle ai={ai} />
          <div className="flex flex-wrap items-center gap-2">
          {!ai.preset.native && ai.provider !== "builtin" && (
            <input
              className={`${field} w-56`}
              placeholder="Base URL"
              value={ai.cfg.baseURL}
              onChange={(e) => ai.setField("baseURL", e.target.value)}
            />
          )}
          {ai.provider === "builtin" && ai.builtinStatus.kind !== "running" ? (
            // The builtin model is capability-selected + auto-adopted, not user-typed — show it
            // read-only (the real tier model, not a stale saved name) until it's actually running.
            <span className={`${field} w-44 text-gray-400 flex items-center`}>
              {ai.builtinModel?.display ?? "組み込みモデル"}
            </span>
          ) : ai.models.length > 0 ? (
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
          {/* API key / remember are unused for the runtime-managed builtin model — hide them. */}
          {ai.provider !== "builtin" && (
            <>
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
            </>
          )}
          </div>
        </div>
      )}

      {/* Tabs: generate/edit vs the AI task list (in-flight + history) */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-[#2D3A6E]">
        <button
          onClick={() => setTab("gen")}
          className={`px-2 py-0.5 rounded text-[11px] ${tab === "gen" ? "bg-[#3B82F6] text-white" : "bg-[#1a1f3a] text-gray-400 hover:text-white"}`}
        >
          生成・編集
        </button>
        <button
          onClick={() => setTab("tasks")}
          className={`px-2 py-0.5 rounded text-[11px] ${tab === "tasks" ? "bg-[#3B82F6] text-white" : "bg-[#1a1f3a] text-gray-400 hover:text-white"}`}
        >
          タスク{ai.tasks.length > 0 ? ` ${ai.tasks.length}` : ""}
        </button>
        {runningCount > 0 && <span className="text-[10px] text-[#93C5FD] animate-pulse ml-1">● {runningCount} 実行中</span>}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
      {tab === "tasks" ? (
        <AiTasksPanel tasks={ai.tasks} onCancel={ai.cancelTask} onClear={ai.clearTasks} />
      ) : (
      <>
      {/* Scope + Prompt — grows with the dock so the instruction box isn't stuck at 2 rows */}
      <div className="px-3 py-2 flex flex-col gap-2 flex-1 min-h-0">
        {/* Scope = the slide-list selection (no toggle). 1 = focused slide, >1 = batch. */}
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span>編集対象:</span>
          {batch ? (
            <span className="px-2 py-0.5 rounded bg-[#3B82F6]/20 text-[#93C5FD]">選択 {selectedCount} 枚を一括編集</span>
          ) : canSlide ? (
            <span className="px-2 py-0.5 rounded bg-[#1a1f3a] text-[#93C5FD]">スライド {activeSlideNum}</span>
          ) : (
            <span className="text-gray-500">スライドを選択してください</span>
          )}
          {batch && <span className="text-gray-500">— 1つの指示を各スライドに適用 → 確認して採用</span>}
        </div>
        <div className="flex gap-2 flex-1 min-h-0">
          <textarea
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            placeholder={
              slideScope
                ? "このスライドへの指示（例: 箇条書きを3つに / もっと簡潔に / 図を追加 / DBノードを足す / 英語にする）"
                : "作りたいデッキを指示（例: SaaS の営業提案を5枚で。課題→解決→価格→導入事例→次のステップ）"
            }
            className="flex-1 min-h-[3rem] px-2 py-1.5 bg-[#1a1f3a] border border-[#2D3A6E] rounded text-sm text-white resize-none"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && ready) doGenerate();
            }}
          />
          {ai.generating ? (
            <button onClick={ai.cancel} className="self-start px-4 py-2 text-sm bg-[#2D3A6E] hover:bg-[#3B82F6]/40 text-white rounded shrink-0">
              停止
            </button>
          ) : (
            <button
              onClick={doGenerate}
              disabled={!ready}
              className="self-start px-4 py-2 text-sm bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#3B82F6]/30 disabled:text-white/40 text-white font-medium rounded shrink-0"
            >
              {batchRunning ? "一括編集中…" : batch ? `${selectedCount}枚を編集` : "生成"}
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

      {/* 告知 — deterministic repair dropped a corrupt unit (non-blocking) */}
      {ai.notice && (
        <div className="mx-3 mb-2 px-2 py-1.5 bg-amber-900/30 border border-amber-500/40 rounded text-xs text-amber-200">
          {ai.notice}
        </div>
      )}

      {/* Result — for a slide edit show before→after diff so it's never applied
          blind (you see what changed/was dropped) → 採用/却下. Deck gen keeps raw. */}
      {ai.result && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-[#2D3A6E]">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs text-gray-400">
              {ai.generating ? "生成中…" : slideScope && currentSlideMd ? "変更プレビュー（採用前に確認）" : "プレビュー（Markdown）"}
            </span>
            <div className="flex items-center gap-1">
              {slideScope && currentSlideMd && (
                <button
                  onClick={ai.reset}
                  disabled={ai.generating}
                  className="px-2.5 py-1 text-xs bg-[#1a1f3a] hover:bg-[#2D3A6E] disabled:opacity-40 text-gray-300 rounded"
                >
                  却下
                </button>
              )}
              <button
                onClick={doApply}
                disabled={ai.generating || !ai.result.trim()}
                className="px-3 py-1 text-xs bg-[#06B6D4] hover:bg-[#0891B2] disabled:opacity-40 text-white font-medium rounded"
              >
                {slideScope ? "採用 → このスライド" : "適用 → 編集へ"}
              </button>
            </div>
          </div>
          {slideScope && currentSlideMd && !ai.generating ? (
            <DiffView before={currentSlideMd} after={ai.result} fill />
          ) : (
            <pre className="flex-1 min-h-0 overflow-auto px-3 pb-2 text-[11px] text-green-200 font-mono whitespace-pre-wrap">
              {ai.result}
            </pre>
          )}
        </div>
      )}
      </>
      )}
      </div>
      </>
      )}
    </div>
  );
}
