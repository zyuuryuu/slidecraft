import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Transition } from "../engine/html-shell";

/** HTML export transition choices offered in the File menu submenu (slide = default).
 *  `labelKey` is a toolbar-namespace i18n key resolved at render time. */
const HTML_TRANSITIONS = [
  { v: "slide", labelKey: "toolbar.transitionSlide" },
  { v: "fade", labelKey: "toolbar.transitionFade" },
  { v: "zoom", labelKey: "toolbar.transitionZoom" },
  { v: "push", labelKey: "toolbar.transitionPush" },
] as const satisfies ReadonlyArray<{ v: Transition; labelKey: string }>; // `as const` → labelKey narrows to a valid t() key

interface ToolbarProps {
  onSave: () => void;
  onGenerate: () => void;
  /** Export a self-contained standalone HTML presentation (.html) with the chosen transition. */
  onExportHtml?: (transition?: Transition) => void;
  /** Save / open the editable PROJECT (.scft = deck + template). */
  onSaveProject?: () => void;
  onOpenProject?: () => void;
  onAiAssist?: () => void;
  /** Number of AI tasks currently running → a live badge on the AI button. */
  aiRunning?: number;
  /** A 協働 (live-collab) session is active → an emerald pulse on the AI button. */
  aiCollabActive?: boolean;
  generating: boolean;
  hasSpec: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Help/? → docs site (issue #114). */
  onHelp?: () => void;
}

export default function Toolbar({
  onSave,
  onGenerate,
  onExportHtml,
  onSaveProject,
  onOpenProject,
  onAiAssist,
  aiRunning = 0,
  aiCollabActive = false,
  generating,
  hasSpec,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onHelp,
}: ToolbarProps) {
  const { t } = useTranslation();
  const [exportOpen, setExportOpen] = useState(false);
  const [htmlSub, setHtmlSub] = useState(false); // HTML export → transition flyout
  const btn = "px-3 py-1.5 text-sm bg-edge hover:bg-accent/40 text-fg rounded transition-colors";

  return (
    <div className="flex flex-1 items-center gap-2 px-4 py-2">
      <div className="flex items-center gap-1 mr-4">
        <div className="w-1 h-6 bg-accent rounded-full" />
        <h1 className="text-fg font-semibold text-lg tracking-tight">SlideCraft</h1>
      </div>

      {onUndo && (
        <div className="flex items-center gap-0.5">
          <button onClick={onUndo} disabled={!canUndo} title={t("toolbar.undo")} className={`${btn} px-2 disabled:opacity-30 disabled:hover:bg-edge`}>
            ↶
          </button>
          <button onClick={onRedo} disabled={!canRedo} title={t("toolbar.redo")} className={`${btn} px-2 disabled:opacity-30 disabled:hover:bg-edge`}>
            ↷
          </button>
        </div>
      )}

      {onAiAssist && (
        <button
          onClick={onAiAssist}
          title={
            aiCollabActive ? t("toolbar.aiCollabTitle")
              : aiRunning > 0 ? t("toolbar.aiRunningTitle", { n: aiRunning })
                : t("toolbar.aiTitle")
          }
          className={`px-3 py-1.5 text-sm rounded transition-colors inline-flex items-center gap-1.5 ${
            aiCollabActive
              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25"
              : "bg-brand hover:bg-brand text-on-accent"
          }`}
        >
          {aiCollabActive ? t("toolbar.aiCollabLabel") : t("toolbar.aiLabel")}
          {aiCollabActive && <span className="text-emerald-400 leading-none animate-pulse">●</span>}
          {aiRunning > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-fg/25 text-[10px] leading-none animate-pulse">
              {aiRunning}
            </span>
          )}
        </button>
      )}

      <div className="flex-1" />

      {/* File menu — project save/open (.scft = editable) + export (PPTX / Markdown). */}
      <div className="relative">
        <button
          onClick={() => { setExportOpen((v) => !v); setHtmlSub(false); }}
          className="px-4 py-1.5 text-sm bg-accent hover:bg-accent-hi text-on-accent font-medium rounded transition-colors inline-flex items-center gap-1.5"
        >
          {generating ? t("toolbar.exporting") : t("toolbar.file")}
          <span className="text-[10px] opacity-80">▾</span>
        </button>
        {exportOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setExportOpen(false); setHtmlSub(false); }} />
            <div className="absolute right-0 top-full mt-1 z-50 w-60 bg-canvas border border-edge rounded-lg shadow-2xl py-1 text-sm">
              {onOpenProject && (
                <button
                  onClick={() => { setExportOpen(false); onOpenProject(); }}
                  className="w-full px-3 py-1.5 text-fg hover:bg-edge flex items-center justify-between"
                >
                  <span>📂 {t("toolbar.openProject")}</span>
                  <span className="text-faint text-xs">.scft</span>
                </button>
              )}
              {onSaveProject && (
                <button
                  onClick={() => { setExportOpen(false); onSaveProject(); }}
                  disabled={!hasSpec}
                  className="w-full px-3 py-1.5 text-fg hover:bg-edge disabled:opacity-40 flex items-center justify-between"
                >
                  <span>💾 {t("toolbar.saveProject")}</span>
                  <span className="text-faint text-xs">.scft</span>
                </button>
              )}
              <div className="my-1 border-t border-edge" />
              <div className="px-3 pb-0.5 text-[10px] text-faint">{t("toolbar.exportSection")}</div>
              <button
                onClick={() => { setExportOpen(false); onGenerate(); }}
                disabled={!hasSpec || generating}
                className="w-full px-3 py-1.5 text-fg hover:bg-edge disabled:opacity-40 flex items-center justify-between"
              >
                <span>📊 PPTX</span>
                <span className="text-faint text-xs">.pptx</span>
              </button>
              {onExportHtml && (
                <div
                  className="relative"
                  onMouseEnter={() => hasSpec && setHtmlSub(true)}
                  onMouseLeave={() => setHtmlSub(false)}
                >
                  {/* Click = export with the default (slide); hover = pick a transition. */}
                  <button
                    onClick={() => { setExportOpen(false); onExportHtml("slide"); }}
                    disabled={!hasSpec}
                    className="w-full px-3 py-1.5 text-fg hover:bg-edge disabled:opacity-40 flex items-center justify-between"
                  >
                    <span>🌐 HTML</span>
                    <span className="text-faint text-xs">{t("toolbar.transition")} ▸</span>
                  </button>
                  {htmlSub && hasSpec && (
                    <div className="absolute right-full top-0 w-36 bg-canvas border border-edge rounded-lg shadow-2xl py-1">
                      {HTML_TRANSITIONS.map(({ v, labelKey }) => (
                        <button
                          key={v}
                          onClick={() => { setExportOpen(false); setHtmlSub(false); onExportHtml(v); }}
                          className="w-full px-3 py-1.5 text-fg hover:bg-edge flex items-center justify-between"
                        >
                          <span>{t(labelKey)}</span>
                          {v === "slide" && <span className="text-faint text-[10px]">{t("toolbar.transitionDefault")}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => { setExportOpen(false); onSave(); }}
                className="w-full px-3 py-1.5 text-fg hover:bg-edge flex items-center justify-between"
              >
                <span>📝 Markdown</span>
                <span className="text-faint text-xs">.md</span>
              </button>
            </div>
          </>
        )}
      </div>

      {onHelp && (
        <button onClick={onHelp} title={t("toolbar.help")} className={`${btn} px-2.5 font-medium`}>
          ?
        </button>
      )}
    </div>
  );
}
