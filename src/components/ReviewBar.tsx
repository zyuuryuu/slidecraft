/**
 * ReviewBar — the Import-mode "整形レビュー" strip.
 *
 * Triaged into ⚠ 課題 (should fix) and 💡 提案 (optional), each chip jumps to its
 * slide and, where a lever fits, fixes that ONE issue in place: "→表" (deterministic
 * visualize) or "AIで直す" (condense/title via the slide-fix contract). Per-issue
 * granularity — fix exactly what you choose, all undoable.
 */

import type { DeckIssue } from "../engine/deck-diagnostics";

interface ReviewBarProps {
  warnIssues: DeckIssue[];
  tipIssues: DeckIssue[];
  onJump: (slideIndex: number) => void;
  onFixDeterministic: (issue: DeckIssue) => void;
  onFixAI: (issue: DeckIssue, key: string) => void;
  aiConnected: boolean;
  aiFixingKey: string | null;
  aiFixError: string | null;
}

export default function ReviewBar({
  warnIssues, tipIssues, onJump, onFixDeterministic, onFixAI, aiConnected, aiFixingKey, aiFixError,
}: ReviewBarProps) {
  if (warnIssues.length === 0 && tipIssues.length === 0) return null;

  const chip = (d: DeckIssue, key: string, warn: boolean) => {
    // Pure key-value list → deterministic table. Overflow (split+...) is not key-value.
    const canTable = d.levers.includes("visualize") && !d.levers.includes("split");
    const canAI = d.levers.includes("condense") || d.levers.includes("title");
    const fixing = aiFixingKey === key;
    return (
      <span
        key={key}
        className={`shrink-0 flex items-center rounded border ${warn ? "bg-amber-500/15 border-amber-500/40" : "bg-[#161a2b] border-[#252b45] opacity-90"}`}
      >
        <button
          onClick={() => onJump(d.slideIndex)}
          title={`スライド ${d.slideIndex + 1}: ${d.message}（推奨: ${d.levers.join(" / ")}）`}
          className="px-2 py-0.5 rounded-l hover:bg-[#2D3A6E]"
        >
          <span className={warn ? "text-amber-200" : "text-[#6b86a8]"}>S{d.slideIndex + 1}</span>
          <span className={warn ? "text-gray-200" : "text-gray-400"}> {d.message}</span>
        </button>
        {canTable && (
          <button
            onClick={() => onFixDeterministic(d)}
            title="表に変換（決定論・元に戻せます）"
            className="px-1.5 py-0.5 rounded-r border-l border-[#252b45] text-[#5eead4] hover:bg-[#2D3A6E]"
          >
            →表
          </button>
        )}
        {canAI && (
          <button
            onClick={() => onFixAI(d, key)}
            disabled={!aiConnected || !!aiFixingKey}
            title={aiConnected ? "AIでこの課題だけ直す（元に戻せます）" : "AI未接続（AI Assist で設定）"}
            className="px-1.5 py-0.5 rounded-r border-l border-[#252b45] text-[#93C5FD] hover:bg-[#2D3A6E] disabled:opacity-40"
          >
            {fixing ? "…直し中" : "AIで直す"}
          </button>
        )}
      </span>
    );
  };

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 bg-[#0f1117] border-b border-[#2D3A6E] text-[11px] overflow-x-auto shrink-0">
      {warnIssues.length > 0 && <span className="text-amber-400 shrink-0 font-medium">⚠ 課題 {warnIssues.length}</span>}
      {warnIssues.map((d, i) => chip(d, `w${i}`, true))}
      {tipIssues.length > 0 && <span className="text-gray-500 shrink-0 ml-1.5">💡 提案 {tipIssues.length}</span>}
      {tipIssues.map((d, i) => chip(d, `t${i}`, false))}
      {aiFixError && <span className="shrink-0 text-red-300 ml-2">AI失敗: {aiFixError}</span>}
    </div>
  );
}
