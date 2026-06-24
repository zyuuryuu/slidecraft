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
  return (
    <div className="flex flex-1 items-center gap-2 px-4 py-2">
      <div className="flex items-center gap-1 mr-4">
        <div className="w-1 h-6 bg-[#3B82F6] rounded-full" />
        <h1 className="text-white font-semibold text-lg tracking-tight">
          SlideCraft
        </h1>
      </div>

      <button
        onClick={onSave}
        className="px-3 py-1.5 text-sm bg-[#2D3A6E] hover:bg-[#3B82F6]/40 text-white rounded transition-colors"
      >
        Save
      </button>

      {onUndo && (
        <div className="flex items-center gap-0.5">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="元に戻す (⌘/Ctrl+Z)"
            className="px-2 py-1.5 text-sm bg-[#2D3A6E] hover:bg-[#3B82F6]/40 disabled:opacity-30 disabled:hover:bg-[#2D3A6E] text-white rounded transition-colors"
          >
            ↶
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="やり直す (⌘/Ctrl+Shift+Z)"
            className="px-2 py-1.5 text-sm bg-[#2D3A6E] hover:bg-[#3B82F6]/40 disabled:opacity-30 disabled:hover:bg-[#2D3A6E] text-white rounded transition-colors"
          >
            ↷
          </button>
        </div>
      )}

      {onLoadTemplate && (
        <button
          onClick={onLoadTemplate}
          className="px-3 py-1.5 text-sm bg-[#2D3A6E] hover:bg-[#3B82F6]/40 text-white rounded transition-colors"
          title={templateName ? `Template: ${templateName}` : "Load template"}
        >
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

      <button
        onClick={onGenerate}
        disabled={!hasSpec || generating}
        className="px-4 py-1.5 text-sm bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#3B82F6]/30 disabled:text-white/40 text-white font-medium rounded transition-colors"
      >
        {generating ? "Generating..." : "Generate PPTX"}
      </button>
    </div>
  );
}
