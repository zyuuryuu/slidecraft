/**
 * ReviewBar — the "整形レビュー" strip, shown both in the Edit home and the Draft modal.
 *
 * Triaged into ⚠ 課題 (should fix) and 💡 提案 (optional). Each chip jumps to its slide
 * and offers the RIGHT per-slide fix:
 *  - a pure key-value list → "→表" (deterministic, instant, undoable),
 *  - an AI-needing issue (condense / title) → "✨直す", which hands off to the AI dock:
 *    it selects the slide and opens AI Assist with a fix prompt pre-filled, so the human
 *    sees + edits the instruction before generating (never a silent auto-AI).
 * Deck-wide deterministic tidy lives in the Draft modal's "✨ 原稿を整形" button, not here.
 */

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
  if (warnIssues.length === 0 && tipIssues.length === 0) return null;

  const chip = (d: DeckIssue, key: string, warn: boolean) => {
    // Pure key-value list → deterministic table. Overflow (split+...) is not key-value.
    const canTable = d.levers.includes("visualize") && !d.levers.includes("split");
    // condense / title / overflow → needs the AI (assisted handoff).
    const needsAi = onAiFix && (d.levers.includes("condense") || d.levers.includes("title"));
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
            className="px-1.5 py-0.5 border-l border-[#252b45] text-[#5eead4] hover:bg-[#2D3A6E]"
          >
            →表
          </button>
        )}
        {needsAi && (
          <button
            onClick={() => onAiFix(d.slideIndex, fixPromptForIssue(d))}
            title="AI Assist を開いて直す（指示はプリセット・確認/編集してから生成）"
            className="px-1.5 py-0.5 border-l border-[#252b45] text-[#c4b5fd] hover:bg-[#2D3A6E]"
          >
            ✨直す
          </button>
        )}
      </span>
    );
  };

  return (
    // Wrap chips to multiple rows instead of a 1-line horizontal scroll — that scrollbar
    // sat on top of the thin strip and stole clicks. Capped height + vertical scroll for
    // pathological issue counts (the right-edge scrollbar doesn't overlap the chips).
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 bg-[#0f1117] border-b border-[#2D3A6E] text-[11px] shrink-0 max-h-20 overflow-y-auto">
      {warnIssues.length > 0 && <span className="text-amber-400 shrink-0 font-medium">⚠ 課題 {warnIssues.length}</span>}
      {warnIssues.map((d, i) => chip(d, `w${i}`, true))}
      {tipIssues.length > 0 && <span className="text-gray-500 shrink-0 ml-1.5">💡 提案 {tipIssues.length}</span>}
      {tipIssues.map((d, i) => chip(d, `t${i}`, false))}
    </div>
  );
}
