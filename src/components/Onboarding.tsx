/**
 * Onboarding.tsx — first-run orientation panel (Issue #259). Shown once (until "次回以降表示し
 * ない" is checked) so a first-time user isn't dropped straight into an empty Draft with no
 * starting point. Three start actions + a one-line "how it works" + a docs link. GUI-only — no
 * engine/schema involvement.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface OnboardingProps {
  isOpen: boolean;
  /** Close the panel. `skipNextTime` reflects the checkbox at close time (persisted by the caller). */
  onDismiss: (skipNextTime: boolean) => void;
  onNew: () => void;
  onOpenPptx: () => void;
  onViewSample: () => void;
  onOpenDocs: () => void;
}

export default function Onboarding({ isOpen, onDismiss, onNew, onOpenPptx, onViewSample, onOpenDocs }: OnboardingProps) {
  const { t } = useTranslation();
  const [skip, setSkip] = useState(false);

  if (!isOpen) return null;

  // Picking a start action also closes the panel (実装者判断で最小に — see Issue #259): the
  // checkbox controls whether it persists as skipped, not whether THIS session's panel closes.
  const start = (action: () => void) => {
    action();
    onDismiss(skip);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-void/60 flex items-center justify-center p-4"
      onKeyDown={(e) => { if (e.key === "Escape") onDismiss(skip); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("onboarding.dialogLabel")}
        className="bg-void border border-accent/40 rounded-lg shadow-2xl w-full max-w-md flex flex-col"
      >
        <div className="px-4 py-2.5 border-b border-edge flex items-center justify-between">
          <span className="text-sm font-medium text-fg">👋 {t("onboarding.title")}</span>
          <button onClick={() => onDismiss(skip)} className="text-muted hover:text-fg2 text-sm">✕</button>
        </div>

        <div className="p-4 flex flex-col gap-3 text-sm text-fg2">
          <p className="text-xs text-muted">{t("onboarding.howItWorks")}</p>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => start(onNew)}
              className="px-3 py-2 rounded bg-accent hover:bg-accent-hi text-on-accent text-left"
            >
              {t("onboarding.actionNew")}
            </button>
            <button
              onClick={() => start(onOpenPptx)}
              className="px-3 py-2 rounded bg-edge hover:bg-accent/40 text-fg text-left"
            >
              {t("onboarding.actionOpenPptx")}
            </button>
            <button
              onClick={() => start(onViewSample)}
              className="px-3 py-2 rounded bg-edge hover:bg-accent/40 text-fg text-left"
            >
              {t("onboarding.actionSample")}
            </button>
          </div>

          <button onClick={onOpenDocs} className="text-xs text-accent-soft hover:text-fg self-start">
            {t("onboarding.docsLink")}
          </button>
        </div>

        <div className="px-4 py-2.5 border-t border-edge flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            {t("onboarding.skipNextTime")}
          </label>
          <button onClick={() => onDismiss(skip)} className="px-3 py-1.5 text-sm rounded text-fg2 hover:bg-edge shrink-0">
            {t("onboarding.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
