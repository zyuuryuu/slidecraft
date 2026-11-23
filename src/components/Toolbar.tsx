import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Transition } from "../engine/html-shell";
import SettingsMenu from "./SettingsMenu";
import HtmlTransitionPicker from "./HtmlTransitionPicker";
import BarTip from "./BarTip";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BAR_HOVER } from "./bar-button";

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
  /** The template menu (🎨) — App owns its many handlers, so it is passed in as a slot. */
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
  // #724: the bar's 7 buttons are shadcn/ui Buttons (Base UI); their descriptions are Tooltips (was `title=`).
  // secondary = bg-edge (the old look); the app's hover (accent/40) is kept. Height = the Button's 32px (as before).
  const sec = `px-3 font-normal ${BAR_HOVER}`;
  const icon = `font-normal ${BAR_HOVER} disabled:opacity-30`;

  return (
    <TooltipProvider delay={400}>
    <div data-testid="top-bar" className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2">
      {/* #692: min-w-0 lets the bar be narrower than its content's full width, so the 🎨 template name truncates
          (instead of pushing the AI and ⚙ buttons off a narrow window). */}
      <div className="flex items-center gap-1 mr-4">
        <div className="w-1 h-6 bg-accent rounded-full" />
        <h1 className="text-fg font-semibold text-lg tracking-tight">SlideCraft</h1>
      </div>

      {onUndo && (
        <div className="flex items-center gap-0.5">
          <BarTip label={t("toolbar.undo")} disabled={!canUndo}>
            <Button variant="secondary" size="icon" onClick={onUndo} disabled={!canUndo} aria-label={t("toolbar.undo")}
              className={icon}>
              ↶
            </Button>
          </BarTip>
          <BarTip label={t("toolbar.redo")} disabled={!canRedo}>
            <Button variant="secondary" size="icon" onClick={onRedo} disabled={!canRedo} aria-label={t("toolbar.redo")}
              className={icon}>
              ↷
            </Button>
          </BarTip>
        </div>
      )}

      {/* #614: the bar holds only the DOCUMENT's operations — ↶ ↷ ｜ 保存・書き出し 📝原稿入力 🎨テンプレート ｜ ✨AI ⚙ (#692 wording).
          App settings (language / theme / help / AI connection) live in the ⚙ menu at the right end. */}
      <div className="w-px h-6 bg-edge mx-1" aria-hidden />

      {/* File menu — project save/open (.scft = editable) + export (PPTX / Markdown). */}
      <div className="relative">
        <Button onClick={() => setExportOpen((v) => !v)} aria-haspopup="true" aria-expanded={exportOpen} className="px-4 hover:bg-accent-hi">
          {generating ? t("toolbar.exporting") : t("toolbar.file")}
          <span className="text-[10px] opacity-80">▾</span>
        </Button>
        {exportOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-50 w-80 bg-canvas border border-edge rounded-lg shadow-2xl py-1 text-sm">
              {/* #674: each section is a role="group" (as in the master menu) so the UX budget counts it (≤ 7 items). */}
              {/* #692: both sections show their heading (開く・保存／書き出す) so the menu's scope is visible. */}
              <div role="group" aria-label={t("toolbar.projectSection")}>
                <div className="px-3 pt-0.5 pb-0.5 text-[10px] text-faint">{t("toolbar.projectSection")}</div>
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
              </div>
              <div role="group" aria-label={t("toolbar.exportSection")}>
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
            </div>
          </>
        )}
      </div>

      {/* 📝 原稿 (Draft) = secondary action. Gated while collab-locked or while a template adjust is open. */}
      {onDraft && (
        <BarTip label={draftGate === "locked" ? t("app.draftLockedTitle") : t("app.draftButtonTitle")} disabled={!!draftGate}>
          <Button variant="secondary" onClick={onDraft} disabled={!!draftGate} className={`${sec} disabled:opacity-40`}>
            {t("toolbar.draft")}
          </Button>
        </BarTip>
      )}

      {master}

      <div className="flex-1" />

      {onAiAssist && (
        <BarTip
          label={
            aiCollabActive ? t("toolbar.aiCollabTitle")
              : aiRunning > 0 ? t("toolbar.aiRunningTitle", { n: aiRunning })
                : t("toolbar.aiTitle")
          }
        >
        <Button
          onClick={onAiAssist}
          className={`px-3 font-normal ${
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
        </Button>
        </BarTip>
      )}

      <SettingsMenu onHelp={onHelp} onAiSettings={onAiSettings} />
    </div>
    </TooltipProvider>
  );
}
