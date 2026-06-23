import { useRef, useState } from "react";
import Editor, { type EditorHandle } from "./components/Editor";
import SlidePreview from "./components/SlidePreview";
import SlideList from "./components/SlideList";
import SlideEditor from "./components/SlideEditor";
import SlideMarkdownEditor from "./components/SlideMarkdownEditor";
import ResizableSplit from "./components/ResizableSplit";
import Toolbar from "./components/Toolbar";
import StatusBar from "./components/StatusBar";
import LlmAssist from "./components/LlmAssist";
import AiPanel from "./components/AiPanel";
import { useDeckController } from "./components/useDeckController";

export default function App() {
  const {
    subMode, setSubMode, showLlmAssist, setShowLlmAssist, showAiPanel, setShowAiPanel,
    slideEditView, setSlideEditView, mdText, deck, templateData, parseError, generating,
    filePath, activeSlide, setActiveSlide, gotoLine, templateName,
    undoDeck, redoDeck, canUndo, canRedo, handleEditorChange, handleLoadTemplate,
    handleOpen, handleSave, handleGenerate, hasContent,
    handleLlmImport, handleAiApply, handleStartEditing, handleExportMd, handleStructureManuscript, handleSlideUpdate,
    handleDiagramChange, handleApplySlide, deckHint, diagnostics, contentBox, activeSlideIssues, handleFixIssue, currentSlideMd, handleSlideMdChange,
    currentSlide, currentLayoutName, currentLayout, handleCursorLine, handleSlideClick,
  } = useDeckController();

  // Triage the review: 課題 (warn = overflow / no title, should fix) vs 提案
  // (info = condense / table-able, optional) so the skippable ones read as skippable.
  const warnIssues = diagnostics.filter((d) => d.level === "warn");
  const tipIssues = diagnostics.filter((d) => d.level === "info");

  // In Import mode the Markdown editor owns undo (incl. programmatic 整形 / →表 edits),
  // so route the toolbar's Undo/Redo to the editor's history there; deck history in Edit.
  const editorRef = useRef<EditorHandle>(null);
  const [editorHist, setEditorHist] = useState({ canUndo: false, canRedo: false });
  const importMode = subMode === "import";

  return (
    <>
      <div className="flex items-stretch bg-[#1E2761] border-b border-[#3B82F6]/30">
        <Toolbar
          onOpen={handleOpen}
          onSave={handleSave}
          onGenerate={handleGenerate}
          onLoadTemplate={handleLoadTemplate}
          onAiAssist={() =>
            subMode === "edit" ? setShowAiPanel((v) => !v) : setShowLlmAssist(true)
          }
          generating={generating}
          hasSpec={hasContent}
          templateName={templateName}
          onUndo={importMode ? () => editorRef.current?.undo() : undoDeck}
          onRedo={importMode ? () => editorRef.current?.redo() : redoDeck}
          canUndo={importMode ? editorHist.canUndo : canUndo}
          canRedo={importMode ? editorHist.canRedo : canRedo}
        />
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex rounded overflow-hidden border border-[#3B82F6]/40 text-xs">
            <button
              onClick={() => setSubMode("import")}
              className={`px-3 py-1 transition-colors ${
                subMode === "import"
                  ? "bg-[#3B82F6] text-white"
                  : "bg-[#1E2761] text-gray-400 hover:text-white"
              }`}
            >
              Import
            </button>
            <button
              onClick={handleStartEditing}
              className={`px-3 py-1 transition-colors ${
                subMode === "edit"
                  ? "bg-[#3B82F6] text-white"
                  : "bg-[#1E2761] text-gray-400 hover:text-white"
              }`}
            >
              Edit
            </button>
            {subMode === "edit" && (
              <button
                onClick={handleExportMd}
                className="px-3 py-1 transition-colors bg-[#1E2761] text-gray-400 hover:text-white border-l border-[#3B82F6]/40"
              >
                Export MD
              </button>
            )}
          </div>
          {subMode === "import" && (
            <button
              onClick={handleStructureManuscript}
              title="生原稿（見出し＋文章）を、見出しごとのスライド（箇条書き化）に自動整形"
              className="px-2.5 py-1 text-xs rounded bg-[#1E2761] text-[#93C5FD] hover:bg-[#2D3A6E] border border-[#3B82F6]/40"
            >
              ✨ 原稿を整形
            </button>
          )}
        </div>
      </div>

      {/* ── Markdown editor + live preview ── */}
      {subMode === "import" && (
        <>
          {/* Non-destructive review — 課題 (should fix) prominent, 提案 (optional) muted */}
          {diagnostics.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-[#0f1117] border-b border-[#2D3A6E] text-[11px] overflow-x-auto shrink-0">
              {warnIssues.length > 0 && (
                <span className="text-amber-400 shrink-0 font-medium">⚠ 課題 {warnIssues.length}</span>
              )}
              {warnIssues.map((d, i) => (
                <button
                  key={`w${i}`}
                  onClick={() => handleSlideClick(d.slideIndex)}
                  title={`スライド ${d.slideIndex + 1}: ${d.message}（推奨: ${d.levers.join(" / ")}）`}
                  className="shrink-0 px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40"
                >
                  <span className="text-amber-200">S{d.slideIndex + 1}</span>
                  <span className="text-gray-200"> {d.message}</span>
                </button>
              ))}
              {tipIssues.length > 0 && (
                <span className="text-gray-500 shrink-0 ml-1.5">💡 提案 {tipIssues.length}</span>
              )}
              {tipIssues.map((d, i) => (
                <span
                  key={`t${i}`}
                  className="shrink-0 flex items-center rounded bg-[#161a2b] border border-[#252b45] opacity-90"
                >
                  <button
                    onClick={() => handleSlideClick(d.slideIndex)}
                    title={`スライド ${d.slideIndex + 1}: ${d.message}（任意 / 推奨: ${d.levers.join(" / ")}）`}
                    className="px-2 py-0.5 rounded-l hover:bg-[#2D3A6E]"
                  >
                    <span className="text-[#6b86a8]">S{d.slideIndex + 1}</span>
                    <span className="text-gray-400"> {d.message}</span>
                  </button>
                  {/* visualize is deterministic → fix it in place, instantly, undoable */}
                  {d.levers.includes("visualize") && (
                    <button
                      onClick={() => handleFixIssue(d)}
                      title="表に変換（決定論・元に戻せます）"
                      className="px-1.5 py-0.5 rounded-r border-l border-[#252b45] text-[#5eead4] hover:bg-[#2D3A6E]"
                    >
                      →表
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
        <ResizableSplit
          storageKey="slidecraft_split_import"
          left={
            <>
              <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">
                Markdown Editor
              </div>
              <div className="flex-1 min-h-0">
                <Editor
                  ref={editorRef}
                  value={mdText}
                  onChange={handleEditorChange}
                  language="markdown"
                  onCursorLine={handleCursorLine}
                  gotoLine={gotoLine}
                  onHistory={(canUndo, canRedo) => setEditorHist({ canUndo, canRedo })}
                />
              </div>
            </>
          }
          right={
            <>
              <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">
                Slide Preview
              </div>
              <div className="flex-1 min-h-0 bg-[#0f1117]">
                <SlidePreview
                  deck={deck}
                  template={templateData}
                  error={parseError}
                  activeSlide={activeSlide}
                  onSlideClick={handleSlideClick}
                />
              </div>
            </>
          }
        />
        </>
      )}

      {/* ── Markdown Edit mode (3-pane) ── */}
      {subMode === "edit" && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 flex min-h-0">
          {/* Left: Slide list */}
          <div className="w-[220px] border-r border-[#2D3A6E] flex flex-col min-h-0 bg-[#0a0e1a]">
            <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">
              Slides
            </div>
            <div className="flex-1 min-h-0">
              <SlideList
                deck={deck}
                template={templateData}
                activeIndex={activeSlide}
                onSelect={setActiveSlide}
              />
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
                    <SlideMarkdownEditor
                      key={activeSlide}
                      md={currentSlideMd ?? ""}
                      onChange={handleSlideMdChange}
                    />
                  ) : (
                    <SlideEditor
                      slide={currentSlide}
                      layout={currentLayout}
                      onChange={(updated) => handleSlideUpdate(activeSlide, updated)}
                    />
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
                  <SlidePreview
                    deck={deck}
                    template={templateData}
                    error={parseError}
                    activeSlide={activeSlide}
                    singleSlide
                    onDiagramChange={handleDiagramChange}
                  />
                </div>
              </>
            }
          />
          </div>
          {showAiPanel && (
            <AiPanel
              onApply={handleAiApply}
              onClose={() => setShowAiPanel(false)}
              currentSlideMd={currentSlideMd}
              onApplySlide={handleApplySlide}
              templateHint={deckHint}
              issues={activeSlideIssues}
              contentBox={contentBox}
            />
          )}
        </div>
      )}

      <StatusBar spec={null} error={parseError} filePath={filePath} />

      <LlmAssist
        isOpen={showLlmAssist}
        onClose={() => setShowLlmAssist(false)}
        onImportResult={handleLlmImport}
        templateHint={deckHint}
      />
    </>
  );
}
