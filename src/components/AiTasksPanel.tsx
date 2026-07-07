/**
 * AiTasksPanel — the AI task list, embedded as the "タスク" tab inside AiPanel.
 *
 * Shows every AI request (foreground generate, batch edits, the loop's per-slide calls)
 * as a uniform list: status, scope label, duration, 中止. A row expands to reveal the
 * EXACT prompt that was sent (the user message + which mode = which system prompt) and
 * the raw result — for debugging / transparency. See ROADMAP "AI タスク管理".
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AiTask } from "./useAiGeneration";
import { systemPromptForMode } from "../engine/llm-prompts";

const STATUS: Record<AiTask["status"], { icon: string; cls: string }> = {
  running: { icon: "●", cls: "text-accent-soft animate-pulse" },
  done: { icon: "✓", cls: "text-green-400" },
  error: { icon: "✕", cls: "text-red-400" },
  cancelled: { icon: "⊘", cls: "text-faint" },
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
  const { t: tr } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="flex-1 min-h-0 flex flex-col text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-edge shrink-0">
        <span className="text-muted">{tr("aiTasks.taskCount", { count: tasks.length })}</span>
        {tasks.length > 0 && (
          <button onClick={onClear} className="text-faint hover:text-fg2">
            {tr("aiTasks.clearHistory")}
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="px-3 py-6 text-faint text-center">{tr("aiTasks.empty")}</div>
        ) : (
          tasks.map((t) => {
            const s = STATUS[t.status];
            const dur = t.finishedAt ? `${((t.finishedAt - t.startedAt) / 1000).toFixed(1)}s` : "";
            const open = expanded === t.id;
            return (
              <div key={t.id} className="border-b border-canvas">
                <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-canvas">
                  <span className={s.cls}>{s.icon}</span>
                  <button onClick={() => setExpanded(open ? null : t.id)} className="flex-1 min-w-0 text-left" title={tr("aiTasks.rowExpandHint")}>
                    <div className="text-fg2 truncate">{t.label}</div>
                    {t.status === "error" && t.error && (
                      <div className="text-red-400/80 text-[10px] truncate">{t.error}</div>
                    )}
                  </button>
                  {dur && <span className="text-faint text-[10px] shrink-0">{dur}</span>}
                  {t.status === "running" && (
                    <button onClick={() => onCancel(t.id)} className="text-amber-400 hover:text-amber-300 text-[10px] shrink-0">
                      {tr("aiTasks.cancel")}
                    </button>
                  )}
                  <button onClick={() => setExpanded(open ? null : t.id)} className="text-faint shrink-0">{open ? "▴" : "▾"}</button>
                </div>
                {open && (
                  <div className="px-3 pb-2 space-y-2 bg-void border-t border-canvas">
                    <div>
                      <div className="text-faint text-[10px] pt-1.5 pb-0.5">{tr("aiTasks.systemPrompt", { mode: t.mode })}</div>
                      <pre className="whitespace-pre-wrap break-words text-accent-soft/80 max-h-44 overflow-auto bg-canvas border border-canvas rounded p-2 text-[10px] leading-relaxed">
                        {systemPromptForMode(t.mode, new Date(t.startedAt).toISOString().slice(0, 10))}
                      </pre>
                    </div>
                    <div>
                      <div className="text-faint text-[10px] pb-0.5">{tr("aiTasks.userMessage")}</div>
                      <pre className="whitespace-pre-wrap break-words text-fg2 max-h-44 overflow-auto bg-canvas border border-canvas rounded p-2 text-[10px] leading-relaxed">{t.prompt}</pre>
                    </div>
                    {t.result && (
                      <div>
                        <div className="text-faint text-[10px] pb-0.5">{tr("aiTasks.result")}</div>
                        <pre className="whitespace-pre-wrap break-words text-green-200/90 max-h-44 overflow-auto bg-canvas border border-canvas rounded p-2 text-[10px] leading-relaxed">{t.result}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
