/**
 * IntakeSummaryBar — makes slide-master INTAKE transparent (the user asked: show progress *during* and
 * a result *after*, because Import was "暗黙的"). One fixed top banner, above the Draft modal (z), that:
 *  - while an intake runs → a live progress row (indeterminate for the fast paths; a real fraction for
 *    the AI best-of-N candidates), so long AI Re-makes don't look frozen; and
 *  - after it finishes → an inline one-line summary (mode · health · layout count · AI/fallback) with a
 *    「詳細」toggle that expands the full breakdown: the AI mapping table (source → canonical base + the
 *    reason, the data plumbed in ADR-0026 §9.1), extracted theme (fonts + palette + logo), repairs, and
 *    any health findings. Dismissable; re-openable from the MasterPicker ⓘ.
 *
 * Pure presentation — all data comes from apply-template's IntakeSummary + the AI result fields.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { IntakeSummary, IntakeProgress } from "./apply-template";
import type { MappedLayout } from "../engine/master-remake-ai";

export type IntakeMode = "import" | "remake" | "remake-ai";

export interface IntakeResult {
  mode: IntakeMode;
  name: string;
  summary: IntakeSummary;
  usedAi?: boolean;
  note?: string;
  mappings?: MappedLayout[];
  ts: number;
}

export interface IntakeBusy {
  mode: IntakeMode;
  phase: IntakeProgress;
}

const MODE_ICON: Record<IntakeMode, string> = { import: "📥", remake: "🔁", "remake-ai": "✨" };

/** Coarse monotonic fraction so the bar reads as real progress. AI best-of-N dominates the wall-clock,
 *  so the generating phase spans the bulk (10→85%); the fast pre/post phases bracket it. */
export function phaseFraction(p: IntakeProgress): number {
  switch (p.phase) {
    case "loading": return 0.06;
    case "generating": return 0.1 + 0.75 * (p.step / Math.max(1, p.total));
    case "composing": return 0.9;
    case "validating": return 0.97;
  }
}

function ProgressRow({ busy }: { busy: IntakeBusy }) {
  const { t } = useTranslation();
  const p = busy.phase;
  const label =
    p.phase === "generating"
      ? t("intake.progress.generating", { step: p.step, total: p.total })
      : t(`intake.progress.${p.phase}`);
  const pct = Math.round(phaseFraction(p) * 100);
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-accent-soft">
        <span className="animate-pulse">{MODE_ICON[busy.mode]}</span>
        <span>{t(`intake.mode.${busy.mode}`)}</span>
        <span className="text-fg2">— {label}</span>
      </div>
      <div
        className="mt-1.5 h-1 rounded-full bg-edge overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full bg-accent-soft transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Swatches({ palette }: { palette: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5 align-middle">
      {palette.slice(0, 9).map((c, i) => (
        <span key={i} className="inline-block w-3 h-3 rounded-sm border border-edge" style={{ background: c }} title={c} />
      ))}
    </span>
  );
}

export function Detail({ result }: { result: IntakeResult }) {
  const { t } = useTranslation();
  const s = result.summary;
  return (
    <div className="px-3 pb-2.5 pt-1 text-xs text-fg2 space-y-2 max-h-[40vh] overflow-y-auto">
      {s.theme && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted">{t("intake.theme")}:</span>
          <span>{s.theme.major === s.theme.minor ? t("intake.font", { name: s.theme.major }) : t("intake.fonts", { major: s.theme.major, minor: s.theme.minor })}</span>
          <Swatches palette={s.theme.palette} />
          <span className="text-muted">{s.theme.logo ? t("intake.logoYes") : t("intake.logoNo")}</span>
        </div>
      )}
      {result.mode === "remake-ai" && result.mappings && result.mappings.length > 0 && (
        <div>
          <div className="text-muted mb-1">{t("intake.mappingTitle")}</div>
          <table className="w-full border-collapse">
            <tbody>
              {result.mappings.map((m: MappedLayout, i) => (
                <tr key={i} className="border-b border-edge/50 last:border-0">
                  <td className="py-0.5 pr-2 text-fg truncate max-w-[10rem]">{m.rename || m.base}</td>
                  <td className="py-0.5 px-1 text-muted">→</td>
                  <td className="py-0.5 pr-2 text-accent-soft whitespace-nowrap">{m.base}</td>
                  <td className="py-0.5 text-dim">{m.reason || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.mode === "import" && (s.repairs ?? 0) > 0 && (
        <div><span className="text-muted">{t("intake.repairs")}:</span> {t("intake.repairsCount", { count: s.repairs })}</div>
      )}
      {s.findings.length > 0 && (
        <ul className="list-disc list-inside text-amber-300/90 space-y-0.5">
          {s.findings.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function IntakeSummaryBar({
  busy, result, onDismiss,
}: {
  busy: IntakeBusy | null;
  result: IntakeResult | null;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!busy && !result) return null;

  // Only offer 「詳細」 when there's something to expand — a clean faithful Import has no theme, mappings,
  // repairs, or findings, so its one-line summary is the whole story (no empty expander).
  const s = result?.summary;
  const hasDetail = !!result && (
    !!s?.theme ||
    (result.mode === "remake-ai" && !!result.mappings?.length) ||
    (result.mode === "import" && (s?.repairs ?? 0) > 0) ||
    (s?.findings.length ?? 0) > 0
  );

  return (
    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[55] w-[min(92vw,44rem)]" role="status">
      <div className="bg-surface border border-accent/40 rounded-lg shadow-2xl overflow-hidden">
        {busy ? (
          <ProgressRow busy={busy} />
        ) : result ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2 text-xs">
              <span>{MODE_ICON[result.mode]}</span>
              <span className="text-accent-soft font-medium">{t(`intake.mode.${result.mode}`)}</span>
              <span
                className={
                  result.summary.status === "ok" ? "text-emerald-400"
                  : result.summary.status === "degraded" ? "text-amber-300" : "text-red-400"
                }
              >
                {result.summary.status === "ok" ? "✓" : result.summary.status === "degraded" ? "△" : "✕"} {t(`intake.status.${result.summary.status}`)}
              </span>
              <span className="text-fg2">{t("intake.layoutCount", { count: result.summary.layoutCount })}</span>
              {result.mode === "remake-ai" && (
                <span className="text-muted">{result.usedAi ? t("intake.aiUsed") : t("intake.aiFallback")}</span>
              )}
              <div className="flex-1" />
              {hasDetail && (
                <button onClick={() => setOpen((v) => !v)} className="text-accent-soft hover:text-fg px-1">
                  {t("intake.details")} {open ? "▴" : "▾"}
                </button>
              )}
              <button onClick={onDismiss} title={t("intake.dismiss")} className="text-muted hover:text-fg text-base leading-none px-1">×</button>
            </div>
            {open && hasDetail && <Detail result={result} />}
          </>
        ) : null}
      </div>
    </div>
  );
}
