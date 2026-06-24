/**
 * ReviewBar — the "整形レビュー" surface, shown both in the Edit home and the Draft modal.
 *
 * Stays a THIN one-line summary (⚠ 課題 N ・ 💡 提案 M) that's always glanceable; click it
 * to drop down the full list (so a big issue count never grows the strip or needs a
 * horizontal scrollbar). Each row jumps to its slide and offers the RIGHT per-slide fix:
 *  - a pure key-value list → "→表" (deterministic, instant, undoable),
 *  - an AI-needing issue (condense / title) → "✨直す", which hands off to the AI dock:
 *    selects the slide + opens AI Assist with a fix prompt pre-filled (human edits, then
 *    generates — never a silent auto-AI).
 * Deck-wide deterministic tidy lives in the Draft modal's "✨ 原稿を整形" button, not here.
 */

import { useState } from "react";
import type { DeckIssue } from "../engine/deck-diagnostics";

/** A human-readable, editable fix instruction derived from the issue's levers. */
function fixPromptForIssue(d: DeckIssue): string {
  if (d.levers.includes("title")) return "このスライドに、内容を表す簡潔なタイトルを付けてください。";
  if (d.levers.includes("split")) return "情報が多すぎて1スライドに収まりません。要点に絞り、各箇条書きを短いキーフレーズ（目安28字以内）にしてください。情報は省かないでください。";
  if (d.levers.includes("condense")) return "各箇条書きを短いキーフレーズ（目安28字以内）に要約してください。文章ではなく要点に。情報は省かないでください。";
  return "このスライドを、レイアウトに収まるよう簡潔に整えてください。";
}

interface ReviewBarProps {
  warnIssues: DeckIssue[];
  tipIssues: DeckIssue[];
  onJump: (slideIndex: number) => void;
  onFixDeterministic: (issue: DeckIssue) => void;
  /** Hand off an AI-needing issue to the AI dock (select slide + pre-fill the prompt). */
  onAiFix?: (slideIndex: number, prompt: string) => void;
}

export default function ReviewBar({ warnIssues, tipIssues, onJump, onFixDeterministic, onAiFix }: ReviewBarProps) {
  const [open, setOpen] = useState(false);
  if (warnIssues.length === 0 && tipIssues.length === 0) return null;

  const row = (d: DeckIssue, key: string, warn: boolean) => {
    const canTable = d.levers.includes("visualize") && !d.levers.includes("split");
    const needsAi = onAiFix && (d.levers.includes("condense") || d.levers.includes("title"));
    return (
      <div key={key} className="flex items-center gap-2 px-3 py-1.5 border-t border-[#161a2b] hover:bg-[#161a2b]">
        <button
          onClick={() => { onJump(d.slideIndex); setOpen(false); }}
          title={`推奨: ${d.levers.join(" / ")}`}
          className="flex items-baseline gap-1.5 flex-1 min-w-0 text-left"
        >
          <span className={`shrink-0 ${warn ? "text-amber-300" : "text-[#6b86a8]"}`}>S{d.slideIndex + 1}</span>
          <span className={`truncate ${warn ? "text-gray-200" : "text-gray-400"}`}>{d.message}</span>
        </button>
        {canTable && (
          <button
            onClick={() => onFixDeterministic(d)}
            title="表に変換（決定論・元に戻せます）"
            className="shrink-0 px-2 py-0.5 rounded border border-[#252b45] text-[#5eead4] hover:bg-[#2D3A6E]"
          >
            →表
          </button>
        )}
        {needsAi && (
          <button
            onClick={() => { onAiFix(d.slideIndex, fixPromptForIssue(d)); setOpen(false); }}
            title="AI Assist を開いて直す（指示プリセット・確認/編集してから生成）"
            className="shrink-0 px-2 py-0.5 rounded border border-[#252b45] text-[#c4b5fd] hover:bg-[#2D3A6E]"
          >
            ✨直す
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="relative shrink-0 bg-[#0f1117] border-b border-[#2D3A6E] text-[11px]">
      {/* Thin always-visible summary */}
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2.5 w-full px-3 py-1.5 hover:bg-[#161a2b]">
        {warnIssues.length > 0 && <span className="text-amber-400 font-medium">⚠ 課題 {warnIssues.length}</span>}
        {tipIssues.length > 0 && <span className="text-gray-400">💡 提案 {tipIssues.length}</span>}
        <span className="text-gray-600">{open ? "▴" : "▾"}</span>
        <div className="flex-1" />
        <span className="text-gray-600 text-[10px]">{open ? "閉じる" : "詳細を見る"}</span>
      </button>

      {/* Dropdown list (on demand) */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-50 max-h-72 overflow-y-auto bg-[#0f1117] border-b border-[#2D3A6E] shadow-2xl">
            {warnIssues.map((d, i) => row(d, `w${i}`, true))}
            {tipIssues.map((d, i) => row(d, `t${i}`, false))}
          </div>
        </>
      )}
    </div>
  );
}
