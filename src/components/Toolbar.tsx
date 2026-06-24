import { useState } from "react";

interface ToolbarProps {
  onSave: () => void;
  onGenerate: () => void;
  onLoadTemplate?: () => void;
  onAiAssist?: () => void;
  /** Number of AI tasks currently running → a live badge on the AI Assist button. */
  aiRunning?: number;
  generating: boolean;
  hasSpec: boolean;
  templateName?: string;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export default function Toolbar({
  onSave,
  onGenerate,
  onLoadTemplate,
  onAiAssist,
  aiRunning = 0,
  generating,
  hasSpec,
  templateName,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false);
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

      {onLoadTemplate && (
        <button onClick={onLoadTemplate} className={btn} title={templateName ? `Template: ${templateName}` : "Load template"}>
          {templateName ? `Template: ${templateName}` : "Load Template"}
        </button>
      )}

      {onAiAssist && (
        <button
          onClick={onAiAssist}
          title={aiRunning > 0 ? `AI タスク ${aiRunning} 件 実行中` : "AI Assist（生成・整形・タスク履歴）"}
          className="px-3 py-1.5 text-sm bg-[#7C3AED] hover:bg-[#6D28D9] text-white rounded transition-colors inline-flex items-center gap-1.5"
        >
          ✨ AI Assist
          {aiRunning > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-white/25 text-[10px] leading-none animate-pulse">
              {aiRunning}
            </span>
          )}
        </button>
      )}

      <div className="flex-1" />

      {/* Export — merges Save (Markdown) + Generate (PPTX); both are exports. */}
      <div className="relative">
        <button
          onClick={() => setExportOpen((v) => !v)}
          className="px-4 py-1.5 text-sm bg-[#3B82F6] hover:bg-[#2563EB] text-white font-medium rounded transition-colors inline-flex items-center gap-1.5"
        >
          {generating ? "書き出し中…" : "Export"}
          <span className="text-[10px] opacity-80">▾</span>
        </button>
        {exportOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[#0f1117] border border-[#2D3A6E] rounded-lg shadow-2xl py-1 text-sm">
              <button
                onClick={() => { setExportOpen(false); onGenerate(); }}
                disabled={!hasSpec || generating}
                className="w-full px-3 py-1.5 text-white hover:bg-[#2D3A6E] disabled:opacity-40 flex items-center justify-between"
              >
                <span>📊 as PPTX</span>
                <span className="text-gray-500 text-xs">.pptx</span>
              </button>
              <button
                onClick={() => { setExportOpen(false); onSave(); }}
                className="w-full px-3 py-1.5 text-white hover:bg-[#2D3A6E] flex items-center justify-between"
              >
                <span>📝 as Markdown</span>
                <span className="text-gray-500 text-xs">.md</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
