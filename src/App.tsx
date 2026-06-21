import Editor from "./components/Editor";
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
    handleDiagramChange, handleApplySlide, deckHint, diagnostics, currentSlideMd, handleSlideMdChange,
    currentSlide, currentLayoutName, currentLayout, handleCursorLine, handleSlideClick,
  } = useDeckController();

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
          onUndo={undoDeck}
          onRedo={redoDeck}
          canUndo={canUndo}
          canRedo={canRedo}
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
          {/* Non-destructive review: flags slide-design issues + the levers that fix each */}
          {diagnostics.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1 bg-[#0f1117] border-b border-[#2D3A6E] text-[11px] overflow-x-auto shrink-0">
              <span className="text-amber-400 shrink-0 font-medium">⚠ 整形レビュー {diagnostics.length}件</span>
              {diagnostics.map((d, i) => (
                <button
                  key={i}
                  onClick={() => handleSlideClick(d.slideIndex)}
                  title={`スライド ${d.slideIndex + 1}: ${d.message}（推奨レバー: ${d.levers.join(" / ")}）`}
                  className="shrink-0 px-2 py-0.5 rounded bg-[#1a1f3a] hover:bg-[#2D3A6E] border border-[#2D3A6E]"
                >
                  <span className={d.level === "warn" ? "text-amber-300" : "text-[#93C5FD]"}>S{d.slideIndex + 1}</span>
                  <span className="text-gray-300"> {d.message}</span>
                </button>
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
                  value={mdText}
                  onChange={handleEditorChange}
                  language="markdown"
                  onCursorLine={handleCursorLine}
                  gotoLine={gotoLine}
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
