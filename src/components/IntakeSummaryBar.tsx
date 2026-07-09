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
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { IntakeSummary, IntakeProgress } from "./apply-template";
import { SlideCard, SLIDE_W, SLIDE_H } from "./SlidePreview";
import { findLayout, type TemplateData } from "../engine/template-loader";
import { parseMd } from "../engine/md-parser";
import type { DeckIR } from "../engine/slide-schema";

// A mini WYSIWYG preview of a re-made layout: the SAME SlideCard the editor uses, rendered tiny with a
// dummy-filled sample slide — so the user SEES what each mapped layout looks like, not just its name.
const THUMB_W = 208; // px
const THUMB_SCALE = THUMB_W / SLIDE_W;
const THUMB_H = SLIDE_H * THUMB_SCALE;
const THUMB_CAP = 16; // cap the rendered thumbnails (30-layout templates would be heavy); note the rest

function LayoutThumb({ template, sample, name }: { template: TemplateData; sample: DeckIR; name: string }) {
  const layout = findLayout(template, name);
  return (
    <div className="shrink-0" style={{ width: THUMB_W }}>
      <div className="rounded overflow-hidden border border-edge bg-canvas" style={{ width: THUMB_W, height: THUMB_H }}>
        <SlideCard
          slide={sample.slides[0]}
          slideIndex={0}
          totalSlides={1}
          layout={layout}
          masterBgColor={template.masterBgColor ?? "FFFFFF"}
          masterBackgroundImage={template.masterBackgroundImage}
          masterBackgroundGradient={template.masterBackgroundGradient}
          masterDecorations={template.masterDecorations}
          masterImages={template.masterImages}
          masterStaticTexts={template.masterStaticTexts}
          scale={THUMB_SCALE}
          isActive={false}
          exportMode
        />
      </div>
      <div className="mt-0.5 text-[10px] text-fg2 truncate" title={name}>{name}</div>
    </div>
  );
}

export type IntakeMode = "import" | "remake";

export interface IntakeResult {
  mode: IntakeMode;
  name: string;
  summary: IntakeSummary;
  ts: number;
}

export interface IntakeBusy {
  mode: IntakeMode;
  phase: IntakeProgress;
}

const MODE_ICON: Record<IntakeMode, string> = { import: "📥", remake: "🔁" };

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

export function Detail({ result, template, sample }: { result: IntakeResult; template?: TemplateData | null; sample?: DeckIR | null }) {
  const { t } = useTranslation();
  const s = result.summary;
  const layouts = template?.layouts ?? [];
  const shown = layouts.slice(0, THUMB_CAP);
  const showThumbs = !!template && !!sample && sample.slides.length > 0 && shown.length > 0;
  return (
    <div className="px-3 pb-2.5 pt-1 text-xs text-fg2 space-y-2 max-h-[46vh] overflow-y-auto">
      {s.theme && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted">{t("intake.theme")}:</span>
          <span>{s.theme.major === s.theme.minor ? t("intake.font", { name: s.theme.major }) : t("intake.fonts", { major: s.theme.major, minor: s.theme.minor })}</span>
          <Swatches palette={s.theme.palette} />
          <span className="text-muted">{s.theme.logo ? t("intake.logoYes") : t("intake.logoNo")}</span>
        </div>
      )}
      {/* Mini WYSIWYG previews: a dummy-filled sample slide on each layout, so the user SEES the result. */}
      {showThumbs && (
        <div>
          <div className="text-muted mb-1">{t("intake.previewTitle")}</div>
          <div className="flex flex-wrap gap-3">
            {shown.map((l) => (
              <LayoutThumb key={l.name} template={template!} sample={sample!} name={l.name} />
            ))}
          </div>
          {layouts.length > shown.length && (
            <div className="text-dim text-[10px] mt-1">{t("intake.moreLayouts", { count: layouts.length - shown.length })}</div>
          )}
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
  busy, result, onDismiss, template,
}: {
  busy: IntakeBusy | null;
  result: IntakeResult | null;
  onDismiss: () => void;
  /** The active (just-intaken) template — used to render mini WYSIWYG previews of its layouts. */
  template?: TemplateData | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // A dummy-filled sample slide (title + a few bullets) reused for every layout thumbnail. Parsed via the
  // real md-parser so it's a valid DeckIR; SlideCard binds it to each layout's placeholders by role.
  const sample = useMemo(
    () => parseMd(`# ${t("intake.sampleTitle")}\n\n- ${t("intake.sampleBody")}\n- ${t("intake.sampleBody")}\n- ${t("intake.sampleBody")}`),
    [t],
  );
  if (!busy && !result) return null;

  // Only offer 「詳細」 when there's something to expand — a clean faithful Import has no theme,
  // repairs, or findings, so its one-line summary is the whole story (no empty expander).
  const s = result?.summary;
  const hasDetail = !!result && (
    !!s?.theme ||
    (result.mode === "import" && (s?.repairs ?? 0) > 0) ||
    (s?.findings.length ?? 0) > 0 ||
    (template?.layouts?.length ?? 0) > 0 // mini-previews of the template's layouts
  );

  return (
    // A layout-flow banner directly under the toolbar (NOT a floating overlay) — so it never covers the
    // pane headers, the master dropdown, or the bottom Assist dock. It pushes the content down while shown.
    <div className="shrink-0 bg-surface border-b border-accent/40" role="status">
      <div className="mx-auto w-full max-w-5xl">
        {busy ? (
          <ProgressRow busy={busy} />
        ) : result ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2 text-xs">
              {/* Passive status label — NOT actionable. Only 「詳細」/「×」 are buttons. */}
              <span className="text-muted">{t("intake.resultLabel")}</span>
              <span>{MODE_ICON[result.mode]}</span>
              <span className="text-fg2">{t(`intake.mode.${result.mode}`)}</span>
              <span
                className={
                  result.summary.status === "ok" ? "text-emerald-400"
                  : result.summary.status === "degraded" ? "text-amber-300" : "text-red-400"
                }
              >
                {result.summary.status === "ok" ? "✓" : result.summary.status === "degraded" ? "△" : "✕"} {t(`intake.status.${result.summary.status}`)}
              </span>
              <span className="text-fg2">{t("intake.layoutCount", { count: result.summary.layoutCount })}</span>
              <div className="flex-1" />
              {hasDetail && (
                <button onClick={() => setOpen((v) => !v)} className="text-accent-soft hover:text-fg px-1">
                  {t("intake.details")} {open ? "▴" : "▾"}
                </button>
              )}
              <button onClick={onDismiss} title={t("intake.dismiss")} className="text-muted hover:text-fg text-base leading-none px-1">×</button>
            </div>
            {open && hasDetail && <Detail result={result} template={template} sample={sample} />}
          </>
        ) : null}
      </div>
    </div>
  );
}
