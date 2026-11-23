/**
 * CollabApprovalDialog — #727 (ADR-0040 D3-2): "〈name〉 wants to connect to SlideCraft [許可] [拒否]". Shown while
 * an AI client waits for the human; one dialog per request (the host already merges simultaneous applications by
 * the same pair). The client ID fingerprint (first 8 chars) tells look-alike names apart. DEFAULT DENY: 拒否 is
 * the focused answer, and closing (✕ / Esc) is a denial. ［この起動中はすべて拒否］ stops a burst of requests.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Decision, PendingView } from "../mcp/host-approval";

interface Props {
  /** the request to answer now (the oldest), or null when nobody waits */
  request: PendingView | null;
  /** how many requests wait in total (this one included) */
  waiting: number;
  onDecide: (requestId: string, decision: Decision) => void;
}

export default function CollabApprovalDialog({ request, waiting, onDecide }: Props) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onDecide(request.requestId, "deny"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onDecide]);
  if (!request) return null;
  const decide = (d: Decision) => () => onDecide(request.requestId, d);
  const fp = request.kind === "session" ? t("collabApproval.fingerprintSession", { fp: request.fingerprint }) : t("collabApproval.fingerprintAdapter", { fp: request.fingerprint });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/60 p-6" role="dialog" aria-modal="true" aria-label={t("collabApproval.title")}>
      <div className="w-[420px] max-w-full bg-canvas border border-edge rounded-lg shadow-2xl p-4 space-y-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-fg font-medium">{t("collabApproval.title")}</h2>
          <button onClick={decide("deny")} className="text-muted hover:text-fg px-1" title={t("collabApproval.closeIsDeny")} aria-label={t("collabApproval.closeIsDeny")}>✕</button>
        </div>
        <p className="text-fg2 leading-relaxed">
          {t("collabApproval.body", { name: request.name, version: request.version })}
        </p>
        <p className="text-[11px] text-muted font-mono">{fp}</p>
        <p className="text-[11px] text-muted leading-relaxed">{t("collabApproval.hint")}</p>
        {waiting > 1 && <p className="text-[11px] text-amber-300/90">{t("collabApproval.moreWaiting", { count: waiting - 1 })}</p>}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button onClick={decide("deny-all")} className="text-[11px] text-accent-soft hover:text-fg">{t("collabApproval.denyAll")}</button>
          <div className="flex gap-2">
            <button onClick={decide("deny")} autoFocus data-default="true" className="px-3 py-1.5 rounded bg-edge hover:bg-surface text-fg text-xs">{t("collabApproval.deny")}</button>
            <button onClick={decide("allow")} className="px-3 py-1.5 rounded bg-accent hover:bg-accent-hi text-on-accent text-xs font-medium">{t("collabApproval.allow")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
