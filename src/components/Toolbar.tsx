import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Transition } from "../engine/html-shell";
import SettingsMenu from "./SettingsMenu";
import HtmlTransitionPicker from "./HtmlTransitionPicker";
import BarTip from "./BarTip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BarMenuContent, BarMenuItem, BarMenuSection } from "./BarMenu";
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
  // #724: the bar's 7 buttons are shadcn/ui Buttons (Base UI); their descriptions are Tooltips (was `title=`, see BarTip).
  // The TooltipProvider (delay BAR_TOOLTIP_DELAY) wraps the whole app in main.tsx (the draft dialog's 🎨 shares it).
  // secondary = bg-edge (the old look); the app's hover (accent/40) is kept. Height = the Button's 32px (as before).
  const sec = `px-3 font-normal ${BAR_HOVER}`;
  const icon = `font-normal ${BAR_HOVER} disabled:opacity-30`;

  return (
    <div data-testid="top-bar" className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2">
      {/* #692: min-w-0 lets the bar be narrower than its content's full width, so the 🎨 template name truncates
          (instead of pushing the AI and ⚙ buttons off a narrow window). */}
      <div className="flex items-center gap-1 mr-4">
        <div className="w-1 h-6 bg-accent rounded-full" />
        {/* #741: at 760px or less the wordmark makes way (still the page's heading for screen readers): it is not an
            operation, and without its room 「🎨 ▾」 does not fit at 640px (measured). Narrowing goes prefix (860px) →
            wordmark (760px) → template name (MasterPicker, container query), so in the default state the name does not come back as it narrows. */}
        <h1 className="text-fg font-semibold text-lg tracking-tight max-[760px]:sr-only">SlideCraft</h1>
      </div>

      {onUndo && (
        <div className="flex items-center gap-0.5">
          <BarTip label={t("toolbar.undo")}>
            <Button variant="secondary" size="icon" onClick={onUndo} disabled={!canUndo} aria-label={t("toolbar.undo")}
              className={icon}>
              ↶
            </Button>
          </BarTip>
          <BarTip label={t("toolbar.redo")}>
            <Button variant="secondary" size="icon" onClick={onRedo} disabled={!canRedo} aria-label={t("toolbar.redo")}
              className={icon}>
              ↷
            </Button>
          </BarTip>
        </div>
      )}

      {/* #614: the bar holds only the DOCUMENT's operations — ↶ ↷ ｜ 開く・保存・書き出し 📝原稿入力 🎨テンプレート ｜ ✨AI ⚙ (#692 wording).
          App settings (language / theme / help / AI connection) live in the ⚙ menu at the right end. */}
      <div className="w-px h-6 bg-edge mx-1" aria-hidden />

      {/* File menu — project save/open (.scft = editable) + export (PPTX / Markdown). #724: shadcn DropdownMenu (Base UI) —
          an item closes the menu itself; the HTML transition row is not an item (arrow keys skip it, Tab reaches it). */}
      <DropdownMenu open={exportOpen} onOpenChange={setExportOpen}>
        <DropdownMenuTrigger
          render={<Button className="px-4 hover:bg-accent-hi" />}
          aria-expanded={exportOpen}
        >
          {generating ? t("toolbar.exporting") : t("toolbar.file")}
          <span className="text-[10px] opacity-80">▾</span>
        </DropdownMenuTrigger>
        <BarMenuContent className="w-80">
          <FileMenuPanel
            onSave={onSave} onGenerate={onGenerate} onExportHtml={onExportHtml} onSaveProject={onSaveProject} onOpenProject={onOpenProject}
            generating={generating} hasSpec={hasSpec} htmlTransition={htmlTransition} onHtmlTransition={setHtmlTransition}
          />
        </BarMenuContent>
      </DropdownMenu>

      {/* 📝 原稿 (Draft) = secondary action. Gated while collab-locked or while a template adjust is open; the tooltip says why
          with the same words as the AI dock's guidance (#713: one key per reason). */}
      {onDraft && (
        <BarTip label={draftGate === "locked" ? t("app.draftGateLocked") : draftGate === "busy" ? t("app.draftGateBusy") : t("app.draftButtonTitle")}>
          <Button variant="secondary" onClick={onDraft} disabled={!!draftGate} className={`${sec} disabled:opacity-40`}>
            {t("toolbar.draft")}
          </Button>
        </BarTip>
      )}

      {/* #741: the 🎨 picker sits in a size container that takes the bar's free space (it was a spacer after it). The picker
          reads its width (container query `/master`) to hide the template name when less than one character + ellipsis fits.
          The width cannot be a viewport breakpoint: the room left depends on the language and the AI button's state. */}
      <div className="@container/master flex min-w-0 flex-1">{master}</div>

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
  );
}

type FileMenuProps = Pick<ToolbarProps, "onSave" | "onGenerate" | "onExportHtml" | "onSaveProject" | "onOpenProject" | "generating" | "hasSpec"> & {
  htmlTransition: Transition;
  onHtmlTransition: (v: Transition) => void;
};

/** The File menu's body (rendered inside the DropdownMenu; on its own it needs a `DropdownMenu` root around it). */
export function FileMenuPanel({
  onSave, onGenerate, onExportHtml, onSaveProject, onOpenProject, generating, hasSpec, htmlTransition, onHtmlTransition,
}: FileMenuProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* #674: each section is a role="group" (as in the master menu) so the UX budget counts it (≤ 7 items).
          #692: both sections show their heading (開く・保存／書き出す) so the menu's scope is visible. */}
      <BarMenuSection label={t("toolbar.projectSection")} first heading>
        {onOpenProject && (
          <BarMenuItem onClick={() => onOpenProject()} className="justify-between">
            <span>📂 {t("toolbar.openProject")}</span>
            <span className="text-faint text-xs">.scft</span>
          </BarMenuItem>
        )}
        {onSaveProject && (
          <BarMenuItem onClick={() => onSaveProject()} disabled={!hasSpec} className="justify-between">
            <span>💾 {t("toolbar.saveProject")}</span>
            <span className="text-faint text-xs">.scft</span>
          </BarMenuItem>
        )}
      </BarMenuSection>
      <BarMenuSection label={t("toolbar.exportSection")} first={false} heading>
        <BarMenuItem onClick={() => onGenerate()} disabled={!hasSpec || generating} className="justify-between">
          <span>📊 PPTX</span>
          <span className="text-faint text-xs">.pptx</span>
        </BarMenuItem>
        {onExportHtml && (
          <>
            {/* #650: the transition is picked in the row below (no flyout → nesting stays ≤ 2); click exports with it. */}
            <BarMenuItem onClick={() => onExportHtml(htmlTransition)} disabled={!hasSpec}>
              <span>🌐 HTML</span>
            </BarMenuItem>
            <HtmlTransitionPicker value={htmlTransition} onChange={onHtmlTransition} disabled={!hasSpec} />
          </>
        )}
        <BarMenuItem onClick={() => onSave()} className="justify-between">
          <span>📄 Markdown</span>
          <span className="text-faint text-xs">.md</span>
        </BarMenuItem>
      </BarMenuSection>
    </>
  );
}
