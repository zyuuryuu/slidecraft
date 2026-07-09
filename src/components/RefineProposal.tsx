/**
 * RefineProposal — the review gate for the closed-loop refiner (stage C).
 *
 * The loop ([[refine]] / [[use-deck-refine]]) NEVER applies AI edits blind: it returns
 * a proposal (before→after per slide), shown here for the human to 採用 (one undo step)
 * or キャンセル. Deterministic and AI changes are labelled so it's clear what the model
 * touched vs what the harness fixed mechanically.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import DiffView from "./DiffView";
import type { RefineResult, RefineChange } from "../engine/refine";

export default function RefineProposal({
  proposal,
  onAccept,
  onCancel,
}: {
  proposal: RefineResult;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  const LEVER_LABEL: Record<RefineChange["lever"], string> = {
    visualize: t("refineProposal.leverVisualize"),
    condense: t("refineProposal.leverCondense"),
    title: t("refineProposal.leverTitle"),
    split: t("refineProposal.leverSplit"),
    polish: t("refineProposal.leverPolish"),
    edit: t("refineProposal.leverEdit"),
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const { changes, converged } = proposal;
  const detCount = changes.filter((c) => c.kind === "deterministic").length;
  const aiCount = changes.filter((c) => c.kind === "ai").length;
  const nothing = changes.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/60 p-6" role="dialog" aria-modal="true" aria-label={t("refineProposal.dialogLabel")}>
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-canvas border border-edge rounded-lg shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3 border-b border-edge">
          <div className="text-sm text-accent-soft font-medium">{t("refineProposal.heading")}</div>
          <div className="text-xs text-muted mt-1">
            {nothing
              ? converged
                ? t("refineProposal.nothingConverged")
                : t("refineProposal.nothingNotConverged")
              : <>
                  <span className="text-fg2">{t("refineProposal.countSlides", { count: changes.length })}</span> {t("refineProposal.willTidy")}
                  <span className="text-faint">{aiCount > 0
                    ? t("refineProposal.breakdownWithAi", { detCount, aiCount })
                    : t("refineProposal.breakdownDetOnly", { detCount })}</span>
                  {converged ? "" : <span className="text-amber-300/80">{t("refineProposal.someIssuesRemain")}</span>}
                </>}
          </div>
        </div>

        {/* Change list (before → after) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          {changes.map((c, i) => (
            <div key={i} className="border border-surface rounded">
              <div className="px-2.5 py-1 bg-canvas text-[11px] flex items-center gap-2 border-b border-surface">
                <span className="text-accent-soft font-medium">{t("refineProposal.slideN", { n: c.slideIndex + 1 })}</span>
                <span className="text-cyan">{LEVER_LABEL[c.lever] ?? c.lever}</span>
                <span className={c.kind === "ai" ? "text-purple-300" : "text-faint"}>
                  {c.kind === "ai" ? t("refineProposal.kindAi") : t("refineProposal.kindDeterministic")}
                </span>
              </div>
              <div className="p-2">
                <DiffView before={c.beforeMd} after={c.afterMd} />
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-edge flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded bg-field text-fg2 hover:bg-surface border border-edge">
            {nothing ? t("refineProposal.close") : t("refineProposal.cancel")}
          </button>
          {!nothing && (
            <button onClick={onAccept} className="px-3 py-1.5 text-xs rounded bg-accent text-on-accent hover:bg-accent-hi font-medium">
              {t("refineProposal.accept", { count: changes.length })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
