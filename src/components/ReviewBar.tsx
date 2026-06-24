/**
 * ReviewBar — the "整形レビュー" strip, shown both in the Edit home and in the
 * Initialize modal.
 *
 * Triaged into ⚠ 課題 (should fix) and 💡 提案 (optional). Each chip jumps to its
 * slide; a pure key-value list also offers "→表" (deterministic, instant, undoable —
 * deck-op in Edit, Markdown-span in the Initialize modal). AI fixes are NOT here —
 * they live in the Edit AI dock with a before→after diff + 採用/却下, so no edit is
 * ever applied blind.
 */

import { useState } from "react";
import type { DeckIssue } from "../engine/deck-diagnostics";
import type { RefineLevel } from "../engine/refine";

interface ReviewBarProps {
  warnIssues: DeckIssue[];
  tipIssues: DeckIssue[];
  onJump: (slideIndex: number) => void;
  onFixDeterministic: (issue: DeckIssue) => void;
  /** Run the whole-deck closed loop at the chosen intensity (stage C). Absent in the
   *  Initialize modal, where fixes are Markdown-span rewrites. */
  onRefine?: (level: RefineLevel) => void;
  refining?: boolean;
  aiReady?: boolean;
}

export default function ReviewBar({ warnIssues, tipIssues, onJump, onFixDeterministic, onRefine, refining, aiReady }: ReviewBarProps) {
  // Intensity: 2 = deterministic only (safe), 3 = + AI for the residue (condense/title).
  // Default to AI when a provider is ready, else deterministic.
  const [level, setLevel] = useState<2 | 3>(aiReady ? 3 : 2);
  if (warnIssues.length === 0 && tipIssues.length === 0) return null;
  const effLevel: RefineLevel = !aiReady && level === 3 ? 2 : level;

  const chip = (d: DeckIssue, key: string, warn: boolean) => {
    // Pure key-value list → deterministic table. Overflow (split+...) is not key-value.
    const canTable = d.levers.includes("visualize") && !d.levers.includes("split");
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
      </span>
    );
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-[#0f1117] border-b border-[#2D3A6E] text-[11px] shrink-0">
      <div className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0">
        {warnIssues.length > 0 && <span className="text-amber-400 shrink-0 font-medium">⚠ 課題 {warnIssues.length}</span>}
        {warnIssues.map((d, i) => chip(d, `w${i}`, true))}
        {tipIssues.length > 0 && <span className="text-gray-500 shrink-0 ml-1.5">💡 提案 {tipIssues.length}</span>}
        {tipIssues.map((d, i) => chip(d, `t${i}`, false))}
      </div>
      {onRefine && (
        <div className="flex items-center gap-1 shrink-0 pl-2 border-l border-[#2D3A6E]">
          <select
            value={level}
            onChange={(e) => setLevel(Number(e.target.value) as 2 | 3)}
            title="整形の強度：決定論レバーを先に当て、AI は残った課題だけに使います"
            className="bg-[#1a1f3a] border border-[#2D3A6E] rounded text-white px-1 py-0.5"
          >
            <option value={2}>決定論のみ</option>
            <option value={3} disabled={!aiReady}>{aiReady ? "AIも使う" : "AIも使う（未接続）"}</option>
          </select>
          <button
            onClick={() => onRefine(effLevel)}
            disabled={refining}
            title="課題のあるスライドを一括で整える（決定論先行→残りだけAI）。結果はレビューしてから採用"
            className="px-2 py-0.5 rounded bg-[#3B82F6] text-white hover:bg-[#2563EB] disabled:opacity-50"
          >
            {refining ? "整形中…" : "✨ まとめて整える"}
          </button>
        </div>
      )}
    </div>
  );
}
