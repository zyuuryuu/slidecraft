/**
 * RefineProposal — the review gate for the closed-loop refiner (stage C).
 *
 * The loop ([[refine]] / [[use-deck-refine]]) NEVER applies AI edits blind: it returns
 * a proposal (before→after per slide), shown here for the human to 採用 (one undo step)
 * or キャンセル. Deterministic and AI changes are labelled so it's clear what the model
 * touched vs what the harness fixed mechanically.
 */

import { useEffect } from "react";
import DiffView from "./DiffView";
import type { RefineResult, RefineChange } from "../engine/refine";

const LEVER_LABEL: Record<RefineChange["lever"], string> = {
  visualize: "表に変換",
  condense: "要約",
  title: "タイトル",
  split: "分割",
  edit: "AI編集",
};

export default function RefineProposal({
  proposal,
  onAccept,
  onCancel,
}: {
  proposal: RefineResult;
  onAccept: () => void;
  onCancel: () => void;
}) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/60 p-6" role="dialog" aria-modal="true" aria-label="整形プロポーザル">
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-canvas border border-edge rounded-lg shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3 border-b border-edge">
          <div className="text-sm text-accent-soft font-medium">整形の確認</div>
          <div className="text-xs text-muted mt-1">
            {nothing
              ? converged
                ? "すべて整っています。適用する変更はありません。"
                : "自動で直せる変更はありませんでした（残る課題は手動 / 上流で対応）。"
              : <>
                  <span className="text-fg2">{changes.length} 枚</span> を整えます
                  <span className="text-faint">（決定論 {detCount}{aiCount > 0 ? ` ・ AI ${aiCount}` : ""}）</span>
                  {converged ? "" : <span className="text-amber-300/80"> ・ 一部の課題は残ります</span>}
                </>}
          </div>
        </div>

        {/* Change list (before → after) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          {changes.map((c, i) => (
            <div key={i} className="border border-surface rounded">
              <div className="px-2.5 py-1 bg-canvas text-[11px] flex items-center gap-2 border-b border-surface">
                <span className="text-accent-soft font-medium">スライド {c.slideIndex + 1}</span>
                <span className="text-cyan">{LEVER_LABEL[c.lever] ?? c.lever}</span>
                <span className={c.kind === "ai" ? "text-purple-300" : "text-faint"}>
                  {c.kind === "ai" ? "AI" : "決定論"}
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
            {nothing ? "閉じる" : "キャンセル"}
          </button>
          {!nothing && (
            <button onClick={onAccept} className="px-3 py-1.5 text-xs rounded bg-accent text-on-accent hover:bg-accent-hi font-medium">
              ✓ 採用（{changes.length} 件）
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
