import { useState } from "react";
import type { Transition } from "../engine/html-shell";

/** HTML export transition choices offered in the File menu submenu (slide = default). */
const HTML_TRANSITIONS: Array<{ v: Transition; label: string }> = [
  { v: "slide", label: "スライド" },
  { v: "fade", label: "フェード" },
  { v: "zoom", label: "ズーム" },
  { v: "push", label: "プッシュ" },
];

interface ToolbarProps {
  onSave: () => void;
  onGenerate: () => void;
  /** Export a self-contained standalone HTML presentation (.html) with the chosen transition. */
  onExportHtml?: (transition?: Transition) => void;
  /** Save / open the editable PROJECT (.slidecraft = deck + template). */
  onSaveProject?: () => void;
  onOpenProject?: () => void;
  onAiAssist?: () => void;
  /** Number of AI tasks currently running → a live badge on the AI button. */
  aiRunning?: number;
  /** A 協働 (live-collab) session is active → an emerald pulse on the AI button. */
  aiCollabActive?: boolean;
  generating: boolean;
  hasSpec: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export default function Toolbar({
  onSave,
  onGenerate,
  onExportHtml,
  onSaveProject,
  onOpenProject,
  onAiAssist,
  aiRunning = 0,
  aiCollabActive = false,
  generating,
  hasSpec,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const [htmlSub, setHtmlSub] = useState(false); // HTML export → transition flyout
  const btn = "px-3 py-1.5 text-sm bg-[#2D3A6E] hover:bg-[#3B82F6]/40 text-white rounded transition-colors";

  return (
    <div className="flex flex-1 items-center gap-2 px-4 py-2">
      <div className="flex items-center gap-1 mr-4">
        <div className="w-1 h-6 bg-[#3B82F6] rounded-full" />
        <h1 className="text-white font-semibold text-lg tracking-tight">SlideCraft</h1>
      </div>

      {onUndo && (
        <div className="flex items-center gap-0.5">
          <button onClick={onUndo} disabled={!canUndo} title="元に戻す (⌘/Ctrl+Z)" className={`${btn} px-2 disabled:opacity-30 disabled:hover:bg-[#2D3A6E]`}>
            ↶
          </button>
          <button onClick={onRedo} disabled={!canRedo} title="やり直す (⌘/Ctrl+Shift+Z)" className={`${btn} px-2 disabled:opacity-30 disabled:hover:bg-[#2D3A6E]`}>
            ↷
          </button>
        </div>
      )}

      {onAiAssist && (
        <button
          onClick={onAiAssist}
          title={
            aiCollabActive ? "協働編集中：別の AI とライブ共有中（クリックで AI ドックを開閉）"
              : aiRunning > 0 ? `AI タスク ${aiRunning} 件 実行中`
                : "AI（アシスト・協働・タスク履歴）"
          }
          className={`px-3 py-1.5 text-sm rounded transition-colors inline-flex items-center gap-1.5 ${
            aiCollabActive
              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25"
              : "bg-[#7C3AED] hover:bg-[#6D28D9] text-white"
          }`}
        >
          {aiCollabActive ? "✨ AI・協働編集中" : "✨ AI"}
          {aiCollabActive && <span className="text-emerald-400 leading-none animate-pulse">●</span>}
          {aiRunning > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-white/25 text-[10px] leading-none animate-pulse">
              {aiRunning}
            </span>
          )}
        </button>
      )}

      <div className="flex-1" />

      {/* File menu — project save/open (.slidecraft = editable) + export (PPTX / Markdown). */}
      <div className="relative">
        <button
          onClick={() => { setExportOpen((v) => !v); setHtmlSub(false); }}
          className="px-4 py-1.5 text-sm bg-[#3B82F6] hover:bg-[#2563EB] text-white font-medium rounded transition-colors inline-flex items-center gap-1.5"
        >
          {generating ? "書き出し中…" : "ファイル"}
          <span className="text-[10px] opacity-80">▾</span>
        </button>
        {exportOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setExportOpen(false); setHtmlSub(false); }} />
            <div className="absolute right-0 top-full mt-1 z-50 w-60 bg-[#0f1117] border border-[#2D3A6E] rounded-lg shadow-2xl py-1 text-sm">
              {onOpenProject && (
                <button
                  onClick={() => { setExportOpen(false); onOpenProject(); }}
                  className="w-full px-3 py-1.5 text-white hover:bg-[#2D3A6E] flex items-center justify-between"
                >
                  <span>📂 プロジェクトを開く</span>
                  <span className="text-gray-500 text-xs">.slidecraft</span>
                </button>
              )}
              {onSaveProject && (
                <button
                  onClick={() => { setExportOpen(false); onSaveProject(); }}
                  disabled={!hasSpec}
                  className="w-full px-3 py-1.5 text-white hover:bg-[#2D3A6E] disabled:opacity-40 flex items-center justify-between"
                >
                  <span>💾 プロジェクトを保存</span>
                  <span className="text-gray-500 text-xs">.slidecraft</span>
                </button>
              )}
              <div className="my-1 border-t border-[#2D3A6E]" />
              <div className="px-3 pb-0.5 text-[10px] text-gray-500">書き出す</div>
              <button
                onClick={() => { setExportOpen(false); onGenerate(); }}
                disabled={!hasSpec || generating}
                className="w-full px-3 py-1.5 text-white hover:bg-[#2D3A6E] disabled:opacity-40 flex items-center justify-between"
              >
                <span>📊 PPTX</span>
                <span className="text-gray-500 text-xs">.pptx</span>
              </button>
              {onExportHtml && (
                <div
                  className="relative"
                  onMouseEnter={() => hasSpec && setHtmlSub(true)}
                  onMouseLeave={() => setHtmlSub(false)}
                >
                  {/* Click = export with the default (slide); hover = pick a transition. */}
                  <button
                    onClick={() => { setExportOpen(false); onExportHtml("slide"); }}
                    disabled={!hasSpec}
                    className="w-full px-3 py-1.5 text-white hover:bg-[#2D3A6E] disabled:opacity-40 flex items-center justify-between"
                  >
                    <span>🌐 HTML</span>
                    <span className="text-gray-500 text-xs">遷移 ▸</span>
                  </button>
                  {htmlSub && hasSpec && (
                    <div className="absolute right-full top-0 w-36 bg-[#0f1117] border border-[#2D3A6E] rounded-lg shadow-2xl py-1">
                      {HTML_TRANSITIONS.map(({ v, label }) => (
                        <button
                          key={v}
                          onClick={() => { setExportOpen(false); setHtmlSub(false); onExportHtml(v); }}
                          className="w-full px-3 py-1.5 text-white hover:bg-[#2D3A6E] flex items-center justify-between"
                        >
                          <span>{label}</span>
                          {v === "slide" && <span className="text-gray-500 text-[10px]">既定</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => { setExportOpen(false); onSave(); }}
                className="w-full px-3 py-1.5 text-white hover:bg-[#2D3A6E] flex items-center justify-between"
              >
                <span>📝 Markdown</span>
                <span className="text-gray-500 text-xs">.md</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
