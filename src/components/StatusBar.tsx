import { useState } from "react";
import type { DiagramSpec } from "../engine/schema";
import type { AiTask } from "./useAiGeneration";
import AiTasksPanel from "./AiTasksPanel";

interface StatusBarProps {
  spec: DiagramSpec | null;
  error: string | null;
  filePath: string | null;
  aiTasks: AiTask[];
  onCancelTask: (id: string) => void;
  onClearTasks: () => void;
}

export default function StatusBar({ spec, error, filePath, aiTasks, onCancelTask, onClearTasks }: StatusBarProps) {
  const [showTasks, setShowTasks] = useState(false);
  const running = aiTasks.filter((t) => t.status === "running").length;
  return (
    <div className="flex items-center gap-4 px-4 py-1 bg-[#141B41] text-xs text-gray-400 border-t border-[#2D3A6E]">
      <span>
        {error ? (
          <span className="text-red-400">Error</span>
        ) : spec ? (
          <span className="text-green-400">Ready</span>
        ) : (
          "No input"
        )}
      </span>

      {spec && (
        <>
          <span>Nodes: {spec.nodes.length}</span>
          <span>Edges: {spec.edges.length}</span>
          {spec.groups.length > 0 && <span>Groups: {spec.groups.length}</span>}
          {spec.lanes.length > 0 && <span>Lanes: {spec.lanes.length}</span>}
          <span>Type: {spec.type}</span>
          <span>Direction: {spec.direction}</span>
        </>
      )}

      <div className="flex-1" />
      {filePath && <span className="text-gray-500 truncate max-w-xs">{filePath}</span>}

      {aiTasks.length > 0 && (
        <div className="relative shrink-0">
          <button
            onClick={() => setShowTasks((v) => !v)}
            title="AI タスク（実行中・履歴）"
            className={`px-2 py-0.5 rounded hover:bg-[#2D3A6E] ${running > 0 ? "text-[#93C5FD]" : "text-gray-400"}`}
          >
            {running > 0 ? `🤖 AI ${running} 実行中…` : `🤖 AI 履歴 ${aiTasks.length}`}
          </button>
          {showTasks && (
            <AiTasksPanel tasks={aiTasks} onCancel={onCancelTask} onClear={onClearTasks} onClose={() => setShowTasks(false)} />
          )}
        </div>
      )}
    </div>
  );
}
