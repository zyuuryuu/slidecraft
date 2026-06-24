/**
 * AiTasksPanel — the AI task list, embedded as the "タスク" tab inside AiPanel.
 *
 * Shows every AI request (foreground generate, batch edits, the loop's per-slide calls)
 * as a uniform list: status, scope label, duration, 中止. A row expands to reveal the
 * EXACT prompt that was sent (the user message + which mode = which system prompt) and
 * the raw result — for debugging / transparency. See ROADMAP "AI タスク管理".
 */

import { useState } from "react";
import type { AiTask } from "./useAiGeneration";
import { systemPromptForMode } from "../engine/llm-prompts";

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
  const [expanded, setExpanded] = useState<string | null>(null);

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
            const open = expanded === t.id;
            return (
              <div key={t.id} className="border-b border-[#161a2b]">
                <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#161a2b]">
                  <span className={s.cls}>{s.icon}</span>
                  <button onClick={() => setExpanded(open ? null : t.id)} className="flex-1 min-w-0 text-left" title="クリックで送信プロンプト/結果を表示">
                    <div className="text-gray-200 truncate">{t.label}</div>
                    {t.status === "error" && t.error && (
                      <div className="text-red-400/80 text-[10px] truncate">{t.error}</div>
                    )}
                  </button>
                  {dur && <span className="text-gray-500 text-[10px] shrink-0">{dur}</span>}
                  {t.status === "running" && (
                    <button onClick={() => onCancel(t.id)} className="text-amber-400 hover:text-amber-300 text-[10px] shrink-0">
                      中止
                    </button>
                  )}
                  <button onClick={() => setExpanded(open ? null : t.id)} className="text-gray-500 shrink-0">{open ? "▴" : "▾"}</button>
                </div>
                {open && (
                  <div className="px-3 pb-2 space-y-2 bg-[#0a0e1a] border-t border-[#161a2b]">
                    <div>
                      <div className="text-gray-500 text-[10px] pt-1.5 pb-0.5">System プロンプト（mode: {t.mode}）</div>
                      <pre className="whitespace-pre-wrap break-words text-[#93C5FD]/80 max-h-44 overflow-auto bg-[#0f1117] border border-[#161a2b] rounded p-2 text-[10px] leading-relaxed">
                        {systemPromptForMode(t.mode, new Date(t.startedAt).toISOString().slice(0, 10))}
                      </pre>
                    </div>
                    <div>
                      <div className="text-gray-500 text-[10px] pb-0.5">User メッセージ</div>
                      <pre className="whitespace-pre-wrap break-words text-gray-300 max-h-44 overflow-auto bg-[#0f1117] border border-[#161a2b] rounded p-2 text-[10px] leading-relaxed">{t.prompt}</pre>
                    </div>
                    {t.result && (
                      <div>
                        <div className="text-gray-500 text-[10px] pb-0.5">結果</div>
                        <pre className="whitespace-pre-wrap break-words text-green-200/90 max-h-44 overflow-auto bg-[#0f1117] border border-[#161a2b] rounded p-2 text-[10px] leading-relaxed">{t.result}</pre>
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
