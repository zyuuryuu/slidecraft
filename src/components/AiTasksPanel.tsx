/**
 * AiTasksPanel — the popover for the central AI task store ([[use-ai-generation]]).
 *
 * Shows every AI request (foreground generate, the refine loop's per-slide calls,
 * manual entries) as a uniform list: status, scope label, duration, and a 中止 for any
 * that's still running. This is the visibility/history/cancel the closed loop made
 * necessary (it fires AI N times) — see ROADMAP "AI タスク管理".
 */

import type { AiTask } from "./useAiGeneration";

const STATUS: Record<AiTask["status"], { icon: string; cls: string }> = {
  running: { icon: "●", cls: "text-[#93C5FD] animate-pulse" },
  done: { icon: "✓", cls: "text-green-400" },
  error: { icon: "✕", cls: "text-red-400" },
  cancelled: { icon: "⊘", cls: "text-gray-500" },
};

export default function AiTasksPanel({
  tasks,
  onCancel,
  onClear,
  onClose,
}: {
  tasks: AiTask[];
  onCancel: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* click-away */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full right-0 mb-1 z-50 w-80 max-h-80 flex flex-col bg-[#0f1117] border border-[#2D3A6E] rounded-lg shadow-2xl text-xs">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#2D3A6E] shrink-0">
          <span className="text-[#93C5FD] font-medium">🤖 AI タスク</span>
          {tasks.length > 0 && (
            <button onClick={onClear} className="text-gray-500 hover:text-gray-300">
              履歴をクリア
            </button>
          )}
        </div>
        <div className="overflow-y-auto">
          {tasks.length === 0 ? (
            <div className="px-3 py-5 text-gray-500 text-center">タスクはありません</div>
          ) : (
            tasks.map((t) => {
              const s = STATUS[t.status];
              const dur = t.finishedAt ? `${((t.finishedAt - t.startedAt) / 1000).toFixed(1)}s` : "";
              return (
                <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-[#161a2b]">
                  <span className={s.cls}>{s.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-200 truncate">{t.label}</div>
                    {t.status === "error" && t.error && (
                      <div className="text-red-400/80 text-[10px] truncate" title={t.error}>{t.error}</div>
                    )}
                  </div>
                  {dur && <span className="text-gray-500 text-[10px] shrink-0">{dur}</span>}
                  {t.status === "running" && (
                    <button onClick={() => onCancel(t.id)} className="text-amber-400 hover:text-amber-300 text-[10px] shrink-0">
                      中止
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
