/**
 * AiDeckGuidance.tsx — the AI dock's one-line hint when NO slide is selected (#690).
 *
 * The dock only edits the selected slide(s) (selection = scope), so with nothing selected there is
 * nothing to 生成 — instead of an input that can't be submitted, point to the ONE entry for whole-deck
 * generation: 📝 原稿 → ✨ AIで生成. The link opens the 原稿 screen only (same handler and same gate as the
 * toolbar's 📝 原稿 button — ux-principles.md §2 rule 2: a second entry merely opens the first). When that
 * button is gated, the link is disabled and the reason is said on the same line (never silent).
 */

import { useTranslation } from "react-i18next";

interface AiDeckGuidanceProps {
  /** Open the 原稿 (Initialize) screen — the toolbar's 📝 原稿 handler. Omit → the link is not offered. */
  onOpenDraft?: () => void;
  /** The toolbar's draftGate: "locked" = collab session live, "busy" = a template adjust is open. */
  draftGate?: "locked" | "busy";
}

export default function AiDeckGuidance({ onOpenDraft, draftGate }: AiDeckGuidanceProps) {
  const { t } = useTranslation();
  const target = t("aiPanel.deckGuidanceTarget", { draft: t("toolbar.draft"), generate: t("initModal.generateAi") });
  return (
    <div data-testid="ai-deck-guidance" className="text-xs text-muted leading-relaxed">
      {t("aiPanel.deckGuidance")}
      {onOpenDraft ? (
        <button
          type="button"
          data-testid="ai-deck-guidance-open-draft"
          onClick={onOpenDraft}
          disabled={!!draftGate}
          className="text-accent-soft underline underline-offset-2 hover:text-fg disabled:no-underline disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {target}
        </button>
      ) : (
        <span>{target}</span>
      )}
      {draftGate && (
        <span className="ml-1 text-faint">
          {draftGate === "locked" ? t("aiPanel.deckGuidanceLocked") : t("aiPanel.deckGuidanceBusy")}
        </span>
      )}
    </div>
  );
}
