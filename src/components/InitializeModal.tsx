/**
 * InitializeModal — the "Draft" phase as a modal (not a persistent mode). (UI label
 * "Draft"; the component keeps its original name.)
 *
 * The product's single content entry point: bring Markdown in (paste / open file / AI /
 * 原稿を整形), see how it splits into slides (live preview + structure review), then
 * "スライドにする" to commit the deck and return to the visual Edit home. Markdown lives
 * ONLY here — after commit the deck is the source of truth ([[primary-surface-deck]]).
 */

import { useTranslation } from "react-i18next";
import Editor from "./Editor";
import ReviewBar from "./ReviewBar";
import SlidePreview from "./SlidePreview";
import ResizableSplit from "./ResizableSplit";
import MasterPicker from "./MasterPicker";
import IntakeSummaryBar, { type IntakeBusy, type IntakeResult } from "./IntakeSummaryBar";
import type { MasterEntry } from "./useMasterRegistry";
import type { DeckIR } from "../engine/slide-schema";
import type { TemplateData } from "../engine/template-loader";
import type { DeckIssue } from "../engine/deck-diagnostics";

interface InitializeModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  mdText: string;
  onMdChange: (value: string) => void;
  onOpenFile: () => void;
  onStructure: () => void;
  onGenerateAI: () => void;
  masters: MasterEntry[];
  activeMasterId: string;
  onSelectMaster: (id: string) => void;
  onImportMaster: () => void;
  onRemakeMaster: () => void;
  onRemakeMasterAI?: () => void; // ADR-0026: AI Re-make
  onRemoveMaster?: (id: string) => void; // delete an imported master
  aiReady?: boolean; // gate the AI Re-make item when no provider is connected
  intakeBusy?: IntakeBusy | null; // intake progress/result surfaced INSIDE the modal (it covers the main banner)
  intakeResult?: IntakeResult | null;
  onIntakeDismiss?: () => void;
  deck: DeckIR | null;
  templateData: TemplateData | null;
  parseError: string | null;
  activeSlide: number;
  onSlideClick: (index: number) => void;
  warnIssues: DeckIssue[];
  tipIssues: DeckIssue[];
  onFixDeterministic: (issue: DeckIssue) => void;
  onCursorLine: (line: number) => void;
  gotoLine?: { line: number; ts: number };
}

const action = "px-2.5 py-1 rounded bg-surface text-accent-soft hover:bg-edge border border-accent/40";

export default function InitializeModal({
  isOpen, onCancel, onConfirm, mdText, onMdChange, onOpenFile, onStructure, onGenerateAI,
  masters, activeMasterId, onSelectMaster, onImportMaster, onRemakeMaster, onRemakeMasterAI, onRemoveMaster, aiReady,
  intakeBusy, intakeResult, onIntakeDismiss,
  deck, templateData, parseError, activeSlide, onSlideClick, warnIssues, tipIssues,
  onFixDeterministic, onCursorLine, gotoLine,
}: InitializeModalProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-void/60 flex items-center justify-center p-4 sm:p-6"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("initModal.dialogLabel")}
        className="bg-void border border-accent/40 rounded-lg shadow-2xl flex flex-col w-full max-w-6xl"
        style={{ height: "86vh" }}
      >
        {/* Header + input methods (one tidy row) */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-edge text-xs shrink-0">
          <span className="text-sm text-accent-soft font-medium mr-1">📝 Draft</span>
          <MasterPicker masters={masters} activeId={activeMasterId} onSelect={onSelectMaster} onImport={onImportMaster} onRemake={onRemakeMaster} onRemakeAI={onRemakeMasterAI} onRemove={onRemoveMaster} aiReady={aiReady} />
          <span className="w-px h-4 bg-edge mx-1" />
          <button onClick={onOpenFile} className={action} title={t("initModal.importMarkdownTitle")}>{t("initModal.importMarkdown")}</button>
          <button onClick={onGenerateAI} className={action} title={t("initModal.generateAiTitle")}>{t("initModal.generateAi")}</button>
          <button onClick={onStructure} className={action} title={t("initModal.tidyDraftTitle")}>{t("initModal.tidyDraft")}</button>
          <div className="flex-1" />
          <button onClick={onCancel} title={t("initModal.close")} className="text-muted hover:text-fg text-lg leading-none">×</button>
        </div>

        {/* Intake progress/result for a Re-make triggered from THIS modal (the main-view banner is behind it). */}
        {onIntakeDismiss && (
          <IntakeSummaryBar busy={intakeBusy ?? null} result={intakeResult ?? null} onDismiss={onIntakeDismiss} template={templateData} />
        )}

        {/* Structure review of the resulting split (awareness + per-chip →表). The
            full deterministic tidy is the "🧹 原稿を整形" button above. */}
        <ReviewBar
          warnIssues={warnIssues}
          tipIssues={tipIssues}
          onJump={onSlideClick}
          onFixDeterministic={onFixDeterministic}
        />

        {/* Markdown source ⇄ live slide-split preview (flex-1 child → fills the middle) */}
        <ResizableSplit
          storageKey="slidecraft_split_init"
          left={
            <>
              <div className="px-3 py-1 bg-panel text-xs border-b border-edge">
                <span className="text-muted">Markdown Editor</span>
                <span className="text-dim"> {t("initModal.editorHint")}</span>
              </div>
              <div className="flex-1 min-h-0">
                <Editor value={mdText} onChange={onMdChange} language="markdown" onCursorLine={onCursorLine} gotoLine={gotoLine} />
              </div>
            </>
          }
          right={
            <>
              <div className="px-3 py-1 bg-panel text-xs text-muted border-b border-edge">{t("initModal.previewHeader")}</div>
              <div className="flex-1 min-h-0 bg-canvas">
                <SlidePreview deck={deck} template={templateData} error={parseError} activeSlide={activeSlide} onSlideClick={onSlideClick} />
              </div>
            </>
          }
        />

        {/* Commit / discard */}
        <div className="flex items-center gap-2 px-4 py-2 border-t border-edge shrink-0">
          {!deck && (
            <span className="text-[11px] text-amber-300 truncate">
              {parseError ? t("initModal.parseError", { parseError }) : t("initModal.emptyContent")}
            </span>
          )}
          <div className="flex-1" />
          <button onClick={onCancel} className="px-3 py-1 text-xs bg-field hover:bg-edge text-fg2 rounded">{t("initModal.cancel")}</button>
          <button
            onClick={onConfirm}
            disabled={!deck}
            className="px-4 py-1 text-xs bg-cyan hover:bg-cyan-hi disabled:opacity-40 text-on-accent font-medium rounded"
          >
            {t("initModal.commit")}
          </button>
        </div>
      </div>
    </div>
  );
}
