import ReviewBar from "./components/ReviewBar";
import SlidePreview from "./components/SlidePreview";
import SlideList from "./components/SlideList";
import SlideEditor from "./components/SlideEditor";
import SlideMarkdownEditor from "./components/SlideMarkdownEditor";
import ResizableSplit from "./components/ResizableSplit";
import Toolbar from "./components/Toolbar";
import StatusBar from "./components/StatusBar";
import LlmAssist from "./components/LlmAssist";
import AiPanel from "./components/AiPanel";
import InitializeModal from "./components/InitializeModal";
import RefineProposal from "./components/RefineProposal";
import { useDeckController } from "./components/useDeckController";
import { useAiGeneration, classifyAiFailure } from "./components/useAiGeneration";
import { useDeckRefine } from "./components/useDeckRefine";

export default function App() {
  const {
    subMode, showLlmAssist, setShowLlmAssist, showAiPanel, setShowAiPanel,
    slideEditView, setSlideEditView, mdText, deck, templateData, parseError, generating,
    filePath, activeSlide, selected, selectSlide, gotoLine, templateName,
    undoDeck, redoDeck, canUndo, canRedo, handleEditorChange, handleLoadTemplate,
    handleOpen, handleSave, handleGenerate, hasContent,
    handleLlmImport, handleStartEditing, handleEnterImport, handleCancelInitialize,
    handleStructureManuscript, handleSlideUpdate, handleDiagramChange, handleApplySlide, deckHint,
    diagnostics, handleFixIssue, handleVisualizeSlide, currentSlideMd,
    handleSlideMdChange, currentSlide, currentLayoutName, currentLayout, handleCursorLine, handleSlideClick,
    catalog, setDeck,
  } = useDeckController();

  // One shared AI instance for every surface (AiPanel / LlmAssist / refine loop) so
  // provider + key config can never diverge. The closed-loop refiner (stage C) injects
  // ai.runOnce as its per-slide aiFix and gates the Lv3 AI pass on a ready connection.
  const ai = useAiGeneration();
  const refine = useDeckRefine({
    deck, catalog, setDeck,
    // Maps the task store's promise to a retry-aware outcome: a cancel is never retried,
    // a transient failure (network/timeout/5xx/empty) is — the loop caps the retries.
    aiFix: async (req, meta) => {
      const label = `スライド${meta.slideIndex + 1}を整形${meta.attempt > 1 ? `（再試行${meta.attempt - 1}）` : ""}`;
      try {
        return { ok: true, markdown: await ai.submitAndWait(req, "slide", label, meta.signal) };
      } catch (e) {
        const c = classifyAiFailure(e, meta.signal);
        return c.cancelled ? { ok: false, cancelled: true } : { ok: false, cancelled: false, retryable: c.retryable, message: c.message };
      }
    },
    aiReady: ai.connection.ok,
  });

  // Triage the review: 課題 (warn = overflow / no title, should fix) vs 提案 (info =
  // condense / table-able, optional) so the skippable ones read as skippable.
  const warnIssues = diagnostics.filter((d) => d.level === "warn");
  const tipIssues = diagnostics.filter((d) => d.level === "info");

  // While the Initialize modal is open, make the background non-interactive so Tab /
  // clicks can't reach the (visually obscured) Edit surface behind the dimmer.
  const bgInert = subMode === "import" ? true : undefined;

  return (
    <>
      <div className="flex items-stretch bg-[#1E2761] border-b border-[#3B82F6]/30" inert={bgInert}>
        <Toolbar
          onSave={handleSave}
          onGenerate={handleGenerate}
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
            title="原稿 / Markdown から取り込み・作成（Initialize）"
            className="px-3 py-1 text-xs rounded bg-[#1E2761] text-[#93C5FD] hover:bg-[#2D3A6E] border border-[#3B82F6]/40"
          >
            📄 Import
          </button>
        </div>
      </div>

      {/* ── Edit (home): the visual editing surface is always the main; deck = truth ── */}
      <div className="flex-1 flex flex-col min-h-0" inert={bgInert}>
        {/* Non-destructive review, where you work — fix in deck (undoable) */}
        <ReviewBar
          warnIssues={warnIssues}
          tipIssues={tipIssues}
          onJump={(i) => selectSlide(i)}
          onFixDeterministic={(issue) => handleVisualizeSlide(issue.slideIndex)}
          onRefine={refine.runRefine}
          onCancelRefine={refine.cancelRefine}
          refining={refine.refining}
          aiReady={ai.connection.ok}
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
        warnIssues={warnIssues}
        tipIssues={tipIssues}
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

      {/* Closed-loop refiner: review the proposed before→after changes, then 採用 (one undo) */}
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
