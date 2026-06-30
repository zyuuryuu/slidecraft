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
import CollabPanel from "./components/CollabPanel";
import InitializeModal from "./components/InitializeModal";
import RefineProposal from "./components/RefineProposal";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useDeckController } from "./components/useDeckController";
import { useCollab } from "./components/useCollab";
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
    catalog, setDeck, docs, activeId, switchDoc, closeDoc, editLockedRef, collabRef,
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
        // The refine/condense residue uses the Markdown-ONLY sub-prompt (no JSON-ops branch)
        // so a small in-app model can't mis-pick the design-ops format; a freeform batch edit
        // keeps the dual-mode "slide" prompt (it may want design ops). Validate-and-retry lives
        // in refineDeck for both paths.
        const mode = meta.kind === "condense" ? "condense" : "slide";
        return { ok: true, markdown: await ai.submitAndWait(req, mode, label, meta.signal) };
      } catch (e) {
        const c = classifyAiFailure(e, meta.signal);
        return c.cancelled ? { ok: false, cancelled: true } : { ok: false, cancelled: false, retryable: c.retryable, message: c.message };
      }
    },
    aiReady: ai.connection.ok,
  });

  // P2.4 collaboration: the GUI hosts a local MCP sidecar; an upstream AI connects and its edits
  // mirror into the active deck live. A freshly adopted/seeded doc is applied 'silent' (replace the
  // view, no undo step — so seeding the user's own deck never clobbers it); subsequent AI edits are
  // 'commit' (undoable). Desktop-only.
  const [showCollab, setShowCollab] = useState(false);
  const collab = useCollab({
    applyDeck: (d, isInitial) => setDeck(d, isInitial ? "silent" : "commit"),
    deck,
    templateData,
    templateName,
  });

  // The ONE place editLocked is computed; ref-gated handlers, button disables, and UI locks all
  // derive from it so they can never diverge again. Synced into the ref read by useDeckController.
  const editLocked = collab.status === "connected";

  // P2.5 collaboration bridge + transient toast: while connected, per-slide edits and Undo/Redo are
  // routed to the host (single truth); stale/empty results surface a never-silent toast.
  const [toast, setToast] = useState<{ message: string; ts: number } | undefined>(undefined);
  const notify = useCallback((message: string) => setToast({ message, ts: Date.now() }), []);
  const collabBridge = useMemo(
    () =>
      editLocked
        ? { sendSlideMarkdown: collab.sendSlideMarkdown, serverUndo: collab.serverUndo, serverRedo: collab.serverRedo, notify }
        : null,
    [editLocked, collab.sendSlideMarkdown, collab.serverUndo, collab.serverRedo, notify],
  );
  // Sync the latest observe-lock + bridge into the controller's refs from an EFFECT (not during
  // render → satisfies react-hooks/refs). Handlers read them at event time, after this effect runs.
  useEffect(() => {
    editLockedRef.current = editLocked;
    collabRef.current = collabBridge;
  }, [editLocked, collabBridge, editLockedRef, collabRef]);
  const handleCollabUndo = async () => {
    const r = await collab.serverUndo();
    if (!r.ok) notify("戻せる操作がありません");
  };
  const handleCollabRedo = async () => {
    const r = await collab.serverRedo();
    if (!r.ok) notify("やり直せる操作がありません");
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 2800);
    return () => clearTimeout(t);
  }, [toast]);

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
          onOpenProject={editLocked ? undefined : handleOpenProject}
          onLoadTemplate={editLocked ? undefined : handleLoadTemplate}
          onAiAssist={() => setShowAiPanel((v) => !v)}
          aiRunning={ai.tasks.filter((t) => t.status === "running").length}
          generating={generating}
          hasSpec={hasContent}
          templateName={templateName}
          onUndo={editLocked ? handleCollabUndo : undoDeck}
          onRedo={editLocked ? handleCollabRedo : redoDeck}
          canUndo={editLocked ? true : canUndo}
          canRedo={editLocked ? true : canRedo}
        />
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            onClick={handleEnterImport}
            disabled={editLocked}
            title={editLocked ? "協働接続中は編集ロック中" : "原稿（テキスト）からスライドを作る・取り込む"}
            className="px-3 py-1 text-xs rounded bg-[#1E2761] text-[#93C5FD] hover:bg-[#2D3A6E] border border-[#3B82F6]/40 disabled:opacity-40 disabled:hover:bg-[#1E2761]"
          >
            📝 Draft
          </button>
          <button
            onClick={() => setShowCollab((v) => !v)}
            title="AI と同じデッキをライブ共有（ローカル MCP サイドカー）"
            className="px-3 py-1 text-xs rounded bg-[#1E2761] text-[#93C5FD] hover:bg-[#2D3A6E] border border-[#3B82F6]/40 inline-flex items-center gap-1"
          >
            🔗 協働
            {collab.status === "connected" && <span className="text-emerald-400 leading-none">●</span>}
          </button>
          {editLocked && (
            <span
              title="協働接続中：編集は host（単一の真実）へ送られ AI とライブ共有されます。Undo もホスト側で実行されます。"
              className="px-2 py-1 text-xs rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1"
            >
              ✍️ 協働編集中
            </span>
          )}
        </div>
      </div>

      {/* ── Edit (home): the visual editing surface is always the main; deck = truth ── */}
      <div className="flex-1 flex flex-col min-h-0" inert={bgInert}>
        {/* Multi-document tabs — only rendered when >1 project is open */}
        {/* While connected, switching/closing tabs would repoint the projection onto another doc → pinned. */}
        <DocTabs docs={docs} activeId={activeId} onSwitch={editLocked ? () => {} : switchDoc} onClose={editLocked ? () => {} : closeDoc} />
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
            onBatchEdit={editLocked ? undefined : (instruction) => refine.runBatchEdit([...(selected ?? [])].sort((a, b) => a - b), instruction)}
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
          onAccept={editLocked ? () => {} : refine.acceptProposal}
          onCancel={refine.cancelProposal}
        />
      )}

      {showCollab && (
        <CollabPanel
          onClose={() => setShowCollab(false)}
          available={collab.available}
          status={collab.status}
          url={collab.url}
          token={collab.token}
          hostJsonPath={collab.hostJsonPath}
          error={collab.error}
          docCount={collab.docCount}
          simulating={collab.simulating}
          onStart={collab.start}
          onStop={collab.stop}
          onSimulate={collab.simulateAiEdit}
        />
      )}

      {toast && (
        <div
          key={toast.ts}
          role="status"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-lg bg-[#1E2761] border border-[#3B82F6]/50 text-sm text-amber-100 shadow-2xl"
        >
          {toast.message}
        </div>
      )}
    </>
  );
}
