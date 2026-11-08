import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Transition } from "../engine/html-shell";
import SettingsMenu from "./SettingsMenu";
import HtmlTransitionPicker from "./HtmlTransitionPicker";

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
  /** Help → docs site (issue #114). Lives in the ⚙ menu (#614). */
  onHelp?: () => void;
  /** ⚙ → open the AI dock with its connection settings (#614). */
  onAiSettings?: () => void;
  /** 📝 原稿 (Draft) → the draft modal. Omit → no draft button. */
  onDraft?: () => void;
  /** Draft is gated (collab-locked → `"locked"`, a template adjust open → `"busy"`). */
  draftGate?: "locked" | "busy";
  /** The master menu (🎨) — App owns its many handlers, so it is passed in as a slot. */
  master?: ReactNode;
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
  onAiSettings,
  onDraft,
  draftGate,
  master,
}: ToolbarProps) {
  const { t } = useTranslation();
  const [exportOpen, setExportOpen] = useState(false);
  const [htmlTransition, setHtmlTransition] = useState<Transition>("slide"); // #650: chosen in the File menu itself
  const btn = "px-3 py-1.5 text-sm bg-edge hover:bg-accent/40 text-fg rounded transition-colors";

  return (
    <div data-testid="top-bar" className="flex flex-1 items-center gap-2 px-4 py-2">
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

      {/* #614: the bar holds only the DOCUMENT's operations — ↶ ↷ ｜ ファイル 📝原稿 🎨マスター ｜ ✨AI ⚙.
          App settings (language / theme / help / AI connection) live in the ⚙ menu at the right end. */}
      <div className="w-px h-6 bg-edge mx-1" aria-hidden />

      {/* File menu — project save/open (.scft = editable) + export (PPTX / Markdown). */}
      <div className="relative">
        <button
          onClick={() => setExportOpen((v) => !v)}
          className="px-4 py-1.5 text-sm bg-accent hover:bg-accent-hi text-on-accent font-medium rounded transition-colors inline-flex items-center gap-1.5"
        >
          {generating ? t("toolbar.exporting") : t("toolbar.file")}
          <span className="text-[10px] opacity-80">▾</span>
        </button>
        {exportOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-50 w-80 bg-canvas border border-edge rounded-lg shadow-2xl py-1 text-sm">
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
                <>
                  {/* #650: the transition is picked in the row below (no flyout → nesting stays ≤ 2); click exports with it. */}
                  <button
                    onClick={() => { setExportOpen(false); onExportHtml(htmlTransition); }}
                    disabled={!hasSpec}
                    className="w-full px-3 py-1.5 text-fg hover:bg-edge disabled:opacity-40 flex items-center justify-between"
                  >
                    <span>🌐 HTML</span>
                  </button>
                  <HtmlTransitionPicker value={htmlTransition} onChange={setHtmlTransition} disabled={!hasSpec} />
                </>
              )}
              <button
                onClick={() => { setExportOpen(false); onSave(); }}
                className="w-full px-3 py-1.5 text-fg hover:bg-edge flex items-center justify-between"
              >
                <span>📄 Markdown</span>
                <span className="text-faint text-xs">.md</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* 📝 原稿 (Draft) = secondary action. Gated while collab-locked or while a template adjust is open. */}
      {onDraft && (
        <button
          onClick={onDraft}
          disabled={!!draftGate}
          title={draftGate === "locked" ? t("app.draftLockedTitle") : t("app.draftButtonTitle")}
          className={`${btn} disabled:opacity-40 disabled:hover:bg-edge`}
        >
          {t("toolbar.draft")}
        </button>
      )}

      {master}

      <div className="flex-1" />

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

      <SettingsMenu onHelp={onHelp} onAiSettings={onAiSettings} />
    </div>
  );
}
