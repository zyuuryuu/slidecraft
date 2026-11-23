/**
 * NoticeSlot — #613: the ONE notice place under the toolbar. The update notice, the intake progress/result
 * and the template-adjust band used to stack there (each pushing the body down); now only one shows at a
 * time, chosen by `noticeSlotPlan` (approval > adjust > intake > update), with a badge counting the hidden ones.
 * #727: `approval` = how many AI clients wait for [許可] (the decision itself is the approval dialog), and —
 * once none wait — whether an allowed client could not be saved to the keychain (never silent; dismissable).
 *
 * The bands themselves are unchanged (same components, same props); only where they go and which one shows
 * changes. It stays a layout-flow strip (not an overlay) so the adjust band never hides the preview (#579).
 * The document tabs (DocTabs) and the review bar are not notices and stay outside.
 */
import { useTranslation } from "react-i18next";
import UpdateBanner from "./UpdateBanner";
import IntakeSummaryBar, { type IntakeBusy, type IntakeResult } from "./IntakeSummaryBar";
import TemplateAdjustPanel from "./TemplateAdjustPanel";
import { noticeSlotPlan } from "./notice-slot-plan";
import type { AdjustSession } from "./useTemplateAdjust";
import type { TemplateAdjustRecipe } from "../engine/template-adjust";
import type { TemplateData } from "../engine/template-loader";
import type { DeckIssue } from "../engine/deck-diagnostics";

export interface NoticeSlotProps {
  /** #727: AI clients waiting for [許可]; absent / count 0 = none. `unsaved`: an allowed client could not be saved
   *  to the OS credential store (asked again next launch) — shown in the same band when nobody is waiting. */
  approval?: { count: number; unsaved?: boolean; onDismissUnsaved?: () => void } | null;
  /** "New version available" — null when there is none (or it was dismissed). */
  update: { latestVersion: string; onDismiss: () => void } | null;
  /** Intake progress/result — passed through to IntakeSummaryBar as-is (`result` null when dismissed). */
  intake: {
    busy: IntakeBusy | null;
    result: IntakeResult | null;
    onDismiss: () => void;
    template?: TemplateData | null;
    unbound?: readonly DeckIssue[];
    augmentHint?: boolean;
  };
  /** The open template-adjust session — null when not adjusting. */
  adjust: {
    session: AdjustSession;
    busy: boolean;
    onPreview: (recipe: TemplateAdjustRecipe) => void;
    onApply: (recipe: TemplateAdjustRecipe) => void;
    onCancel: () => void;
  } | null;
}

export default function NoticeSlot({ approval, update, intake, adjust }: NoticeSlotProps) {
  const { t } = useTranslation();
  const plan = noticeSlotPlan({
    approval: (approval?.count ?? 0) > 0 || !!approval?.unsaved,
    adjusting: !!adjust,
    intake: !!intake.busy || !!intake.result, // exactly when IntakeSummaryBar renders something
    update: !!update,
  });
  if (!plan.shown) return null;

  const band =
    plan.shown === "approval" && approval && approval.count > 0 ? (
      <div role="status" className="px-3 py-2 bg-surface border-b border-accent/40 text-xs text-fg">
        {t("collabApproval.bandWaiting", { count: approval.count })}
      </div>
    ) : plan.shown === "approval" && approval ? (
      <div role="status" className="flex items-center gap-2 px-3 py-2 bg-surface border-b border-accent/40 text-xs text-fg">
        <span className="flex-1 min-w-0">{t("collabApproval.grantsUnsaved")}</span>
        {approval.onDismissUnsaved && (
          <button data-testid="grants-unsaved-dismiss" onClick={approval.onDismissUnsaved} title={t("updateBanner.dismiss")} className="text-muted hover:text-fg text-base leading-none px-1">×</button>
        )}
      </div>
    ) : plan.shown === "adjust" && adjust ? (
      <TemplateAdjustPanel {...adjust} />
    ) : plan.shown === "intake" ? (
      <IntakeSummaryBar {...intake} />
    ) : update ? (
      <UpdateBanner latestVersion={update.latestVersion} onDismiss={update.onDismiss} />
    ) : null;

  const names = plan.hidden.map((k) => t(`noticeSlot.kind.${k}`)).join(t("noticeSlot.separator"));
  const hiddenTitle = t("noticeSlot.hiddenTitle", { count: plan.hidden.length, names });
  return (
    <div data-testid="notice-slot" data-notice={plan.shown} className="shrink-0 flex items-stretch">
      <div className="flex-1 min-w-0">{band}</div>
      {plan.hidden.length > 0 && (
        // Same surface + bottom rule as the band beside it, so the badge reads as part of the strip.
        <div className={`shrink-0 flex items-start pt-2 pr-2 bg-surface border-b ${plan.shown === "adjust" ? "border-edge" : "border-accent/40"}`}>
          <span
            data-testid="notice-slot-hidden"
            title={hiddenTitle}
            aria-label={hiddenTitle}
            className="px-1.5 py-0.5 rounded-full bg-edge text-[10px] text-fg2 tabular-nums"
          >+{plan.hidden.length}</span>
        </div>
      )}
    </div>
  );
}
