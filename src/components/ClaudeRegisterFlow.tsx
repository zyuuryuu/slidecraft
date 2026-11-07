/**
 * ClaudeRegisterFlow.tsx — the confirm dialog and the result block of the one-click "Claude Code に登録" (#530).
 * Presentational only: what to show (and whether to fall back to copying) is decided by the pure
 * claude-register-view.ts; CollabRegistration.tsx owns the state and the IPC calls.
 */
import { useTranslation } from "react-i18next";
import type { OutcomeView } from "./claude-register-view";

const btn = "flex-1 py-1 rounded text-[11px] disabled:opacity-50";

/** Shows the exact command and asks for an explicit OK — nothing is written without it. */
export function RegisterConfirm({ command, onRun, onCancel, busy }: { command: string; onRun: () => void; onCancel: () => void; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="alertdialog" aria-labelledby="claude-register-confirm-title" className="rounded border border-accent/40 bg-void p-2 space-y-1.5">
      <p id="claude-register-confirm-title" className="text-[11px] text-fg2 leading-relaxed">{t("collabPanel.registerConfirmTitle")}</p>
      <pre className="px-2 py-1 rounded bg-surface border border-edge text-fg text-[11px] font-mono whitespace-pre-wrap break-all select-all">{command}</pre>
      <div className="flex gap-1.5">
        <button onClick={onRun} disabled={busy} className={`${btn} bg-accent/60 hover:bg-accent text-fg font-medium`}>
          {busy ? t("collabPanel.registerRunning") : t("collabPanel.registerConfirmRun")}
        </button>
        <button onClick={onCancel} disabled={busy} className={`${btn} bg-edge hover:bg-accent/30 text-fg`}>
          {t("collabPanel.registerConfirmCancel")}
        </button>
      </div>
    </div>
  );
}

/** The run result (never-silent: message, exit code, both streams) and, on fallback, what happened to the copy. */
export function RegisterResult({ view, copy }: { view: OutcomeView; copy: "copied" | "failed" | null }) {
  const { t } = useTranslation();
  const ok = view.tone === "ok";
  return (
    <div className="space-y-1">
      {view.message && (
        <p role={ok ? "status" : "alert"} className={`text-[10px] leading-relaxed break-words ${ok ? "text-emerald-300/80" : "text-amber-300/80"}`}>
          {t(`collabPanel.${view.message.key}` as const, view.message.params)}
        </p>
      )}
      {view.details && (
        <pre className="px-2 py-1 rounded bg-void border border-edge text-fg2 text-[10px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">
          {`${t("collabPanel.registerExitCodeLabel")}: ${view.details.exitCode}`}
          {view.details.stdout && `\n--- stdout ---\n${view.details.stdout}`}
          {view.details.stderr && `\n--- stderr ---\n${view.details.stderr}`}
        </pre>
      )}
      {copy === "copied" && <p role="status" className="text-[10px] text-emerald-300/80 leading-relaxed">{t("collabPanel.registerCopiedNotice")}</p>}
      {copy === "failed" && <p role="alert" className="text-[10px] text-amber-300/80 leading-relaxed">{t("collabPanel.copyFailedNotice")}</p>}
    </div>
  );
}
