import ReviewBar from "./components/ReviewBar";
import SlidePreview from "./components/SlidePreview";
import SlideList from "./components/SlideList";
import SlideEditor from "./components/SlideEditor";
import SlideMarkdownEditor from "./components/SlideMarkdownEditor";
import ResizableSplit from "./components/ResizableSplit";
import Toolbar from "./components/Toolbar";
import DocTabs from "./components/DocTabs";
import StatusBar from "./components/StatusBar";
import LlmAssist from "./components/LlmAssist";
import AiPanel from "./components/AiPanel";
import InitializeModal from "./components/InitializeModal";
import RefineProposal from "./components/RefineProposal";
import { useState, useEffect } from "react";
import { useDeckController } from "./components/useDeckController";
import { useAiGeneration, classifyAiFailure } from "./components/useAiGeneration";
import { useDeckRefine } from "./components/useDeckRefine";

export default function App() {
  const {
    subMode, showLlmAssist, setShowLlmAssist, showAiPanel, setShowAiPanel,
    slideEditView, setSlideEditView, mdText, deck, templateData, parseError, generating,
    filePath, activeSlide, selected, selectSlide, gotoLine, templateName,
    undoDeck, redoDeck, canUndo, canRedo, handleEditorChange, handleLoadTemplate,
    handleOpen, handleSave, handleGenerate, handleSaveProject, handleOpenProject, hasContent,
    handleLlmImport, handleStartEditing, handleEnterImport, handleCancelInitialize,
    handleStructureManuscript, handleSlideUpdate, handleDiagramChange, handleApplySlide, deckHint,
    diagnostics, handleFixIssue, handleVisualizeSlide, currentSlideMd,
    handleSlideMdChange, currentSlide, currentLayoutName, currentLayout, handleCursorLine, handleSlideClick,
    catalog, setDeck, docs, activeId, switchDoc, closeDoc,
  } = useDeckController();

  // One shared AI instance for every surface (AiPanel / LlmAssist) so provider + key
  // config can never diverge.
  const ai = useAiGeneration();
  // Scope the AI task list/history to the active document (no cross-project bleed).
  const { setActiveDocId } = ai;
  useEffect(() => {
    setActiveDocId(activeId);
  }, [activeId, setActiveDocId]);
  // Multi-select batch edit (apply ONE instruction to every selected slide) → proposal.
  const refine = useDeckRefine({
    deck, catalog, setDeck,
    aiFix: async (req, meta) => {
      const label = `スライド${meta.slideIndex + 1}を編集${meta.attempt > 1 ? `（再試行${meta.attempt - 1}）` : ""}`;
      try {
        return { ok: true, markdown: await ai.submitAndWait(req, "slide", label, meta.signal) };
      } catch (e) {
        const c = classifyAiFailure(e, meta.signal);
        return c.cancelled ? { ok: false, cancelled: true } : { ok: false, cancelled: false, retryable: c.retryable, message: c.message };
      }
    },
    aiReady: ai.connection.ok,
  });

  // AI-fix handoff (ReviewBar "✨直す"): select the slide + open AI Assist with a fix
  // prompt pre-filled, so the human sees/edits the instruction before generating. `ts`
  // re-seeds even when the same issue is clicked twice.
  const [aiSeed, setAiSeed] = useState<{ prompt: string; ts: number } | undefined>(undefined);
  const handleAiFix = (slideIndex: number, prompt: string) => {
    selectSlide(slideIndex);
    setShowAiPanel(true);
    setAiSeed({ prompt, ts: Date.now() });
  };

  // Phase-split the diagnostics: Initialize = STRUCTURE (overflow/split + key-value, which
  // "自動で整える" handles), Edit = POLISH (the fine details — condense/title — plus →表).
  // Overflow (split) is Initialize's concern; it's not nagged about in Edit.
  const editIssues = diagnostics.filter((d) => !d.levers.includes("split"));
  const initIssues = diagnostics.filter((d) => d.levers.includes("split") || d.levers.includes("visualize"));
  const warn = (list: typeof diagnostics) => list.filter((d) => d.level === "warn");
  const tip = (list: typeof diagnostics) => list.filter((d) => d.level === "info");

  // While the Initialize modal is open, make the background non-interactive so Tab /
  // clicks can't reach the (visually obscured) Edit surface behind the dimmer.
  const bgInert = subMode === "import" ? true : undefined;

  return (
    <>
      <div className="flex items-stretch bg-[#1E2761] border-b border-[#3B82F6]/30" inert={bgInert}>
        <Toolbar
          onSave={handleSave}
          onGenerate={handleGenerate}
          onSaveProject={handleSaveProject}
          onOpenProject={handleOpenProject}
          onLoadTemplate={handleLoadTemplate}
          onAiAssist={() => setShowAiPanel((v) => !v)}
          aiRunning={ai.tasks.filter((t) => t.status === "running").length}
          generating={generating}
          hasSpec={hasContent}
          templateName={templateName}
          onUndo={undoDeck}
          onRedo={redoDeck}
          canUndo={canUndo}
          canRedo={canRedo}
        />
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            onClick={handleEnterImport}
            title="原稿（テキスト）からスライドを作る・取り込む"
            className="px-3 py-1 text-xs rounded bg-[#1E2761] text-[#93C5FD] hover:bg-[#2D3A6E] border border-[#3B82F6]/40"
          >
            📝 Draft
          </button>
        </div>
      </div>

      {/* ── Edit (home): the visual editing surface is always the main; deck = truth ── */}
      <div className="flex-1 flex flex-col min-h-0" inert={bgInert}>
        {/* Multi-document tabs — only rendered when >1 project is open */}
        <DocTabs docs={docs} activeId={activeId} onSwitch={switchDoc} onClose={closeDoc} />
        {/* Non-destructive review, where you work — fix in deck (undoable) */}
        <ReviewBar
          warnIssues={warn(editIssues)}
          tipIssues={tip(editIssues)}
          onJump={(i) => selectSlide(i)}
          onFixDeterministic={(issue) => handleVisualizeSlide(issue.slideIndex)}
          onAiFix={handleAiFix}
        />
        <div className="flex-1 flex min-h-0">
          {/* Left: Slide list */}
          <div className="w-[220px] border-r border-[#2D3A6E] flex flex-col min-h-0 bg-[#0a0e1a]">
            <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">
              Slides
            </div>
            <div className="flex-1 min-h-0">
              <SlideList deck={deck} template={templateData} activeIndex={activeSlide} selected={selected} onSelect={selectSlide} />
            </div>
          </div>

          {/* Center+Right: Slide editor | preview (draggable divider) */}
          <ResizableSplit
            storageKey="slidecraft_split_edit"
            initialLeftPct={55}
            left={
              <>
                <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E] flex items-center justify-between">
                  <span>Slide Editor — {currentLayoutName || "No slide"}</span>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => setSlideEditView("form")}
                      className={`px-2 py-0.5 rounded text-[11px] ${slideEditView === "form" ? "bg-[#3B82F6] text-white" : "bg-[#1a1f3a] text-gray-400 hover:text-white"}`}
                    >
                      フォーム
                    </button>
                    <button
                      onClick={() => setSlideEditView("markdown")}
                      className={`px-2 py-0.5 rounded text-[11px] ${slideEditView === "markdown" ? "bg-[#3B82F6] text-white" : "bg-[#1a1f3a] text-gray-400 hover:text-white"}`}
                    >
                      Markdown
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 bg-[#0f1117]">
                  {!currentSlide ? (
                    <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                      Select a slide
                    </div>
                  ) : slideEditView === "markdown" ? (
                    <SlideMarkdownEditor key={activeSlide} md={currentSlideMd ?? ""} onChange={handleSlideMdChange} />
                  ) : (
                    <SlideEditor key={activeSlide} slide={currentSlide} layout={currentLayout} onChange={(updated) => handleSlideUpdate(activeSlide, updated)} />
                  )}
                </div>
              </>
            }
            right={
              <>
                <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">
                  Preview — Slide {activeSlide + 1}
                </div>
                <div className="flex-1 min-h-0 bg-[#0f1117]">
                  <SlidePreview deck={deck} template={templateData} error={parseError} activeSlide={activeSlide} singleSlide onDiagramChange={handleDiagramChange} />
                </div>
              </>
            }
          />
        </div>
        {showAiPanel && (
          <AiPanel
            onClose={() => setShowAiPanel(false)}
            currentSlideMd={currentSlideMd}
            onApplySlide={handleApplySlide}
            activeSlideNum={activeSlide + 1}
            selectedCount={selected?.size ?? 1}
            onBatchEdit={(instruction) => refine.runBatchEdit([...(selected ?? [])].sort((a, b) => a - b), instruction)}
            batchRunning={refine.refining}
            seed={aiSeed}
            ai={ai}
          />
        )}
      </div>

      <StatusBar spec={null} error={parseError} filePath={filePath} />

      {/* Initialize phase (modal): Markdown lives only here → 確定 commits the deck */}
      <InitializeModal
        isOpen={subMode === "import"}
        onCancel={handleCancelInitialize}
        onConfirm={handleStartEditing}
        mdText={mdText}
        onMdChange={handleEditorChange}
        onOpenFile={handleOpen}
        onStructure={handleStructureManuscript}
        onGenerateAI={() => setShowLlmAssist(true)}
        deck={deck}
        templateData={templateData}
        parseError={parseError}
        activeSlide={activeSlide}
        onSlideClick={handleSlideClick}
        warnIssues={warn(initIssues)}
        tipIssues={tip(initIssues)}
        onFixDeterministic={handleFixIssue}
        onCursorLine={handleCursorLine}
        gotoLine={gotoLine}
      />

      <LlmAssist
        isOpen={showLlmAssist}
        onClose={() => setShowLlmAssist(false)}
        onImportResult={handleLlmImport}
        templateHint={deckHint}
        ai={ai}
      />

      {/* Multi-select batch edit: review the before→after per slide, then 採用 (one undo) */}
      {refine.proposal && (
        <RefineProposal
          proposal={refine.proposal}
          onAccept={refine.acceptProposal}
          onCancel={refine.cancelProposal}
        />
      )}
    </>
  );
}
