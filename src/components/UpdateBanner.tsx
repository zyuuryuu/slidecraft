/**
 * UpdateBanner — "new version available" notice (Issue #113 / ADR-0021 follow-up). Notify-only: no
 * in-app download or auto-update; the user updates via `brew upgrade` or a manual re-download from
 * GitHub Releases per RELEASING.md.
 */
import { useTranslation } from "react-i18next";

export default function UpdateBanner({ latestVersion, onDismiss }: { latestVersion: string; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 bg-surface border-b border-accent/40 flex items-center gap-2 px-3 py-2 text-xs" role="status">
      <span className="text-accent-soft">✨</span>
      <span className="text-fg2">{t("updateBanner.message", { version: latestVersion })}</span>
      <div className="flex-1" />
      <button onClick={onDismiss} title={t("updateBanner.dismiss")} className="text-muted hover:text-fg text-base leading-none px-1">×</button>
    </div>
  );
}
