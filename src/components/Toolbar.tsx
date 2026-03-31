interface ToolbarProps {
  onOpen: () => void;
  onSave: () => void;
  onGenerate: () => void;
  onLoadTemplate?: () => void;
  onAiAssist?: () => void;
  generating: boolean;
  hasSpec: boolean;
  templateName?: string;
  mode?: "diagram" | "markdown";
}

export default function Toolbar({
  onOpen,
  onSave,
  onGenerate,
  onLoadTemplate,
  onAiAssist,
  generating,
  hasSpec,
  templateName,
  mode,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-[#1E2761] border-b border-[#3B82F6]/30">
      <div className="flex items-center gap-1 mr-4">
        <div className="w-1 h-6 bg-[#3B82F6] rounded-full" />
        <h1 className="text-white font-semibold text-lg tracking-tight">
          SlideCraft
        </h1>
      </div>

      <button
        onClick={onOpen}
        className="px-3 py-1.5 text-sm bg-[#2D3A6E] hover:bg-[#3B82F6]/40 text-white rounded transition-colors"
      >
        Open
      </button>

      <button
        onClick={onSave}
        className="px-3 py-1.5 text-sm bg-[#2D3A6E] hover:bg-[#3B82F6]/40 text-white rounded transition-colors"
      >
        Save
      </button>

      {mode === "markdown" && onLoadTemplate && (
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
          className="px-3 py-1.5 text-sm bg-[#7C3AED] hover:bg-[#6D28D9] text-white rounded transition-colors"
        >
          AI Assist
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
