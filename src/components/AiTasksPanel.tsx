/**
 * AiTasksPanel — the AI task list, embedded as the "タスク" tab inside AiPanel.
 *
 * Shows every AI request (foreground generate, the refine loop's per-slide calls,
 * manual entries) as a uniform list: status, scope label, duration, and a 中止 for any
 * still running. This is the visibility/history/cancel the closed loop made necessary
 * (it fires AI N times) — see ROADMAP "AI タスク管理". Lives in AI Assist so the AI
 * surface stays one place (the toolbar button carries a live activity badge).
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
}: {
  tasks: AiTask[];
  onCancel: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#2D3A6E] shrink-0">
        <span className="text-gray-400">{tasks.length} 件のタスク</span>
        {tasks.length > 0 && (
          <button onClick={onClear} className="text-gray-500 hover:text-gray-300">
            履歴をクリア
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="px-3 py-6 text-gray-500 text-center">まだ AI タスクはありません</div>
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
  );
}
