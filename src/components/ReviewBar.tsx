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
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { DeckIssue } from "../engine/deck-diagnostics";

/** A human-readable, editable fix instruction derived from the issue's levers. */
function fixPromptForIssue(d: DeckIssue, t: TFunction): string {
  if (d.levers.includes("title")) return t("reviewBar.promptTitle");
  if (d.levers.includes("split")) return t("reviewBar.promptSplit");
  if (d.levers.includes("condense")) return t("reviewBar.promptCondense");
  if (d.levers.includes("polish")) return t("reviewBar.promptPolish");
  return t("reviewBar.promptTidy");
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (warnIssues.length === 0 && tipIssues.length === 0) return null;

  const row = (d: DeckIssue, key: string, warn: boolean) => {
    const canTable = d.levers.includes("visualize") && !d.levers.includes("split");
    const needsAi = onAiFix && (d.levers.includes("condense") || d.levers.includes("title") || d.levers.includes("polish"));
    return (
      <div key={key} className="flex items-center gap-2 px-3 py-1.5 border-t border-canvas hover:bg-canvas">
        <button
          onClick={() => { onJump(d.slideIndex); setOpen(false); }}
          title={t("reviewBar.recommend", { levers: d.levers.join(" / ") })}
          className="flex items-baseline gap-1.5 flex-1 min-w-0 text-left"
        >
          <span className={`shrink-0 ${warn ? "text-amber-300" : "text-faint"}`}>S{d.slideIndex + 1}</span>
          <span className={`truncate ${warn ? "text-fg2" : "text-muted"}`}>{d.message}</span>
        </button>
        {canTable && (
          <button
            onClick={() => onFixDeterministic(d)}
            title={t("reviewBar.toTableTitle")}
            className="shrink-0 px-2 py-0.5 rounded border border-surface text-cyan hover:bg-edge"
          >
            {t("reviewBar.toTable")}
          </button>
        )}
        {needsAi && (
          <button
            onClick={() => { onAiFix(d.slideIndex, fixPromptForIssue(d, t)); setOpen(false); }}
            title={t("reviewBar.aiFixTitle")}
            className="shrink-0 px-2 py-0.5 rounded border border-surface text-brand-soft hover:bg-edge"
          >
            {t("reviewBar.aiFix")}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="relative shrink-0 bg-canvas border-b border-edge text-[11px]">
      {/* Thin always-visible summary */}
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2.5 w-full px-3 py-1.5 hover:bg-canvas">
        {warnIssues.length > 0 && <span className="text-amber-400 font-medium">{t("reviewBar.warnCount", { n: warnIssues.length })}</span>}
        {tipIssues.length > 0 && <span className="text-muted">{t("reviewBar.tipCount", { n: tipIssues.length })}</span>}
        <span className="text-dim">{open ? "▴" : "▾"}</span>
        <div className="flex-1" />
        <span className="text-dim text-[10px]">{open ? t("reviewBar.collapse") : t("reviewBar.showDetails")}</span>
      </button>

      {/* Dropdown list (on demand) */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-50 max-h-72 overflow-y-auto bg-canvas border-b border-edge shadow-2xl">
            {warnIssues.map((d, i) => row(d, `w${i}`, true))}
            {tipIssues.map((d, i) => row(d, `t${i}`, false))}
          </div>
        </>
      )}
    </div>
  );
}
