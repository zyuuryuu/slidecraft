import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useHistoryState, type HistoryMode } from "./components/useHistoryState";
import { buildCatalog, deckCapabilities } from "./engine/template-catalog";
import { distillDeck } from "./engine/distill";
import { mermaidToDiagramSpec, diagramSpecToYaml } from "./engine/mermaid-to-diagram";
import Editor from "./components/Editor";
import SlidePreview from "./components/SlidePreview";
import SlideList from "./components/SlideList";
import SlideEditor from "./components/SlideEditor";
import SlideMarkdownEditor from "./components/SlideMarkdownEditor";
import ResizableSplit from "./components/ResizableSplit";
import Toolbar from "./components/Toolbar";
import StatusBar from "./components/StatusBar";
import { parseMd } from "./engine/md-parser";
import { serializeMd } from "./engine/md-serializer";
import { loadTemplate, type TemplateData, autoSelectLayout, findLayout } from "./engine/template-loader";
import { generatePptx } from "./engine/placeholder-filler";
import type { DeckIR, SlideIR } from "./engine/slide-schema";
import { readFileFromInput, downloadBlob } from "./ipc/commands";
import LlmAssist from "./components/LlmAssist";
import AiPanel from "./components/AiPanel";
import { MERMAID_CONFIG, rasterizeSvgToPng } from "./components/mermaid";

type MarkdownSubMode = "import" | "edit";

const SAMPLE_MD = `<!-- slide: Title.1Title.Single -->
# NextGen CRM プロジェクト
## 移行計画レビュー

Category: DATA ANALYSIS REPORT
Date: 2026-03-31 | DX推進本部
Footer: Confidential

---

# 本日のアジェンダ
> Today's Agenda

- プロジェクト概要と目的
- 現状分析データの共有
- システム比較と推奨案
- 導入ロードマップ
- Q&A・ネクストステップ

---

# 現状分析
> Current State Analysis

現行CRMの利用状況を分析した結果、以下の課題が明らかになりました。

- 月間アクティブユーザー率: 73%（目標 90%）
- 平均レスポンス時間: 3.2秒（業界平均の3倍）
- モバイル対応: 非対応
- ユーザー満足度: 5段階中 3.2（前年比 -0.3pt）

---

# システム構成図
> System Architecture

\`\`\`diagram
type: flowchart
direction: TB
title: CRM システム構成

nodes:
  - id: client
    label: ブラウザ
    shape: rounded_rect
  - id: api
    label: API Gateway
  - id: crm
    label: CRM Service
  - id: db
    label: Database
    shape: rounded_rect
  - id: ai
    label: AI Engine

edges:
  - from: client
    to: api
  - from: api
    to: crm
  - from: crm
    to: db
  - from: crm
    to: ai
\`\`\`

---

# データフロー
> Mermaid 記法サンプル

\`\`\`mermaid
graph LR
  A[ユーザー入力] --> B{バリデーション}
  B -->|OK| C[データ処理]
  B -->|NG| D[エラー表示]
  C --> E[(データベース)]
  C --> F[レスポンス返却]
\`\`\`

---

<!-- slide: Column.2Body.Equal -->
# スコープ定義
> In Scope / Out of Scope

<!-- col -->
**対象範囲（In Scope）**

- 顧客データ統合基盤
- AI分析エンジン
- 営業支援モジュール
- モバイルアプリ
- 管理者ダッシュボード

<!-- col -->
**対象外（Out of Scope）**

- 基幹系システム（ERP）刷新
- コールセンターシステム
- 海外拠点対応
- 5年以前のデータ移行

---

# リスク分析
> Risk Assessment

プロジェクト遂行にあたり、以下のリスクを識別しています。

- **データ移行の品質リスク**: 既存データの整合性チェックに想定以上の工数
- **ユーザー定着リスク**: 新UIへの習熟に時間がかかり一時的な生産性低下
- **ベンダーロックイン**: クラウドサービスへの依存度増大
- **スケジュール遅延**: 要件変更による開発期間の延長

---

<!-- slide: Column.2Body.Equal -->
# システム比較
> System Comparison

<!-- col -->
**現行CRM**

- レスポンス: 3.2秒
- モバイル: 非対応
- AI機能: なし
- 月額コスト: ¥850/user
- カスタマイズ: 低

<!-- col -->
**新CRM（提案）**

- レスポンス: 0.8秒
- モバイル: 完全対応
- AI機能: 予測分析搭載
- 月額コスト: ¥1,200/user
- カスタマイズ: 高

---

# 導入ロードマップ
> Implementation Roadmap

段階的な移行により、リスクを最小化しながら全社展開を目指します。

- **Phase 1（2026 Q2）**: 要件定義・ベンダー選定
- **Phase 2（2026 Q3-Q4）**: 開発・テスト・データ移行準備
- **Phase 3（2027 Q1）**: パイロット運用（営業部門先行）
- **Phase 4（2027 Q2）**: 全社展開・旧システム廃止

---

<!-- slide: Closing.1Message.Single -->
# ご質問・ご意見をお待ちしています
## Thank You

Category: THANK YOU
Date: プロジェクトマネージャー: 山田 太郎 | taro.yamada@example.com
`;

export default function App() {
  const [subMode, setSubMode] = useState<MarkdownSubMode>("import");
  const [showLlmAssist, setShowLlmAssist] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  // Edit-mode center pane: structured form vs raw per-slide Markdown.
  const [slideEditView, setSlideEditView] = useState<"form" | "markdown">("form");
  const [mdText, setMdText] = useState(SAMPLE_MD);
  // Deck state with unified undo/redo (covers drag/resize, slide edits, AI edits).
  const {
    state: deck,
    set: setDeck,
    reset: resetDeck,
    undo: undoDeck,
    redo: redoDeck,
    canUndo,
    canRedo,
  } = useHistoryState<DeckIR | null>(null);
  const [templateData, setTemplateData] = useState<TemplateData | null>(null);
  // Catalog → layout selection + capacity adapt to the loaded template (canonical = unchanged).
  const catalog = useMemo(() => (templateData ? buildCatalog(templateData) : undefined), [templateData]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [gotoLine, setGotoLine] = useState<{ line: number; ts: number } | undefined>(undefined);
  const [templateName, setTemplateName] = useState("Midnight Executive");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Markdown mode: parse MD ──
  // mode controls undo history: "silent" = editor typing (text owns its undo),
  // "reset" = brand-new deck (file/AI-deck import), "commit" = undoable load.
  const parseMdText = useCallback(
    (text: string, mode: HistoryMode | "reset" = "silent") => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        try {
          const parsed = text.trim() ? parseMd(text) : null;
          // Distill to fit the template: split overflowing content slides (no shrink).
          const fitted = parsed && catalog ? distillDeck(parsed, catalog) : parsed;
          if (mode === "reset") resetDeck(fitted);
          else setDeck(fitted, mode);
          setParseError(null);
        } catch (e) {
          setParseError(e instanceof Error ? e.message : String(e));
          setDeck(null, "silent");
        }
      }, 300);
    },
    [setDeck, resetDeck, catalog],
  );

  // ── Editor change handlers ──
  const handleEditorChange = useCallback(
    (value: string) => {
      setMdText(value);
      parseMdText(value);
    },
    [parseMdText],
  );

  // Keyboard undo/redo — Edit mode only (the Import Markdown editor owns its own
  // text undo, so we don't hijack ⌘Z there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (subMode !== "edit" || !(e.metaKey || e.ctrlKey)) return;
      // Don't hijack undo while editing a text field — it owns its own text undo.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redoDeck();
        else undoDeck();
      } else if (k === "y") {
        e.preventDefault();
        redoDeck();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subMode, undoDeck, redoDeck]);

  // Initial parse (no debounce) + template load
  useState(() => {
    try {
      resetDeck(parseMd(SAMPLE_MD));
    } catch { /* ignore */ }
    // Load template for preview
    fetch("/templates/slide/Midnight_Executive_30_TemplateOnly.pptx")
      .then((r) => r.arrayBuffer())
      .then((buf) => loadTemplate(buf))
      .then(setTemplateData)
      .catch(() => {});
  });

  // When the template (catalog) loads or changes, re-fit the current deck to it —
  // split slides that overflow the new template. Length-guarded so it only fires
  // on an actual split (idempotent → no render loop). Covers the initial sample,
  // which is parsed before the template finishes loading.
  const deckRef = useRef(deck);
  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);
  useEffect(() => {
    if (!catalog || !deckRef.current) return;
    const fitted = distillDeck(deckRef.current, catalog);
    if (fitted.slides.length !== deckRef.current.slides.length) {
      setDeck(fitted, "silent");
    }
  }, [catalog, setDeck]);

  // Load custom template
  const handleLoadTemplate = useCallback(() => {
    templateInputRef.current?.click();
  }, []);

  const handleTemplateSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const tpl = await loadTemplate(buf);
        setTemplateData(tpl);
        setTemplateName(file.name.replace(/\.pptx$/i, ""));
      } catch (err) {
        setParseError(`Template load failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      e.target.value = "";
    },
    [],
  );

  // Open file
  const handleOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const text = await readFileFromInput(file);
      setMdText(text);
      parseMdText(text, "reset");
      setFilePath(file.name);
      e.target.value = "";
    },
    [parseMdText],
  );

  // Save
  const handleSave = useCallback(() => {
    const blob = new Blob([mdText], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filePath ?? "slidecraft.md";
    a.click();
    URL.revokeObjectURL(url);
  }, [mdText, filePath]);

  // Generate PPTX
  const handleGenerate = useCallback(async () => {
    if (!deck || !templateData) return;
    setGenerating(true);
    try {
      // Pre-render each ```mermaid block to an SVG using the SAME config as the
      // on-screen preview, then rasterize it with the browser's own canvas
      // (rasterizeSvgToPng) so the embedded image is pixel-faithful to the
      // preview — same theme, fonts and text. WYSIWYG: preview === output.
      const { default: mermaidLib } = await import("mermaid");
      mermaidLib.initialize(MERMAID_CONFIG);
      const deckWithSvg: DeckIR = {
        ...deck,
        slides: await Promise.all(deck.slides.map(async (slide, i) => {
          if (!slide.mermaidBlock) return slide;
          try {
            const { svg } = await mermaidLib.render(`pptx-mmd-${i}`, slide.mermaidBlock.mermaid);
            return { ...slide, mermaidBlock: { ...slide.mermaidBlock, svgCache: svg } };
          } catch {
            return slide;
          }
        })),
      };
      const buffer = await generatePptx(deckWithSvg, templateData, rasterizeSvgToPng);
      downloadBlob(buffer as unknown as Uint8Array, "slides_output.pptx");
    } catch (e) {
      setParseError(`PPTX generation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  }, [deck, templateData]);

  const hasContent = deck !== null && templateData !== null;


  // ── LLM Assist: import result ──
  const handleLlmImport = useCallback(
    (text: string) => {
      setMdText(text);
      parseMdText(text, "reset");
      setSubMode("import");
    },
    [parseMdText],
  );

  // AI panel "適用"（デッキ全体）: replace the deck but stay in Edit to keep refining.
  const handleAiApply = useCallback(
    (md: string) => {
      setMdText(md);
      parseMdText(md, "commit");
      setActiveSlide(0);
      setSubMode("edit");
    },
    [parseMdText],
  );

  // ── Import → Edit transition ──
  const handleStartEditing = useCallback(() => {
    if (deck) setSubMode("edit");
  }, [deck]);

  // ── Export: Edit → Markdown ──
  const handleExportMd = useCallback(() => {
    if (!deck) return;
    const md = serializeMd(deck);
    setMdText(md);
    setSubMode("import");
  }, [deck]);

  // ── Slide editing: update a single slide in the deck ──
  const handleSlideUpdate = useCallback(
    (index: number, updated: SlideIR, mode: HistoryMode = "coalesce") => {
      if (!deck) return;
      const newSlides = [...deck.slides];
      newSlides[index] = updated;
      setDeck({ ...deck, slides: newSlides }, mode);
    },
    [deck, setDeck],
  );

  // Drag-to-move in the preview, or an AI diagram edit, writes the new diagram YAML
  // back. A Mermaid slide GRADUATES to the canonical DiagramSpec on its first edit:
  // we replace the mermaidBlock with a diagram so every diagram tool (NL edit, node
  // drag/resize/override, shared-painter WYSIWYG) applies from then on.
  const handleDiagramChange = useCallback(
    (yaml: string) => {
      if (!deck) return;
      const slide = deck.slides[activeSlide];
      if (!slide) return;
      if (slide.diagram) {
        handleSlideUpdate(activeSlide, { ...slide, diagram: { ...slide.diagram, yaml } });
      } else if (slide.mermaidBlock) {
        const { mermaidBlock, ...rest } = slide;
        handleSlideUpdate(activeSlide, {
          ...rest,
          diagram: { yaml, placeholderIdx: mermaidBlock.placeholderIdx },
        });
      }
    },
    [deck, activeSlide, handleSlideUpdate],
  );

  // Diagram YAML for the active slide's "図表" AI scope — from the DiagramSpec, or
  // converted on the fly from a Mermaid slide so Mermaid diagrams are editable too.
  const currentDiagramYaml = useMemo(() => {
    const s = deck?.slides[activeSlide];
    if (s?.diagram) return s.diagram.yaml;
    if (s?.mermaidBlock) {
      const spec = mermaidToDiagramSpec(s.mermaidBlock.mermaid);
      return spec ? diagramSpecToYaml(spec) : undefined;
    }
    return undefined;
  }, [deck, activeSlide]);

  // AI panel "適用"（このスライドだけ）: parse the one edited slide and replace only
  // the active slide, preserving any diagram/mermaid the text edit doesn't carry.
  const handleApplySlide = useCallback(
    (md: string) => {
      if (!deck) return;
      const newSlide = parseMd(md).slides[0];
      if (!newSlide) return;
      const old = deck.slides[activeSlide];
      handleSlideUpdate(
        activeSlide,
        {
          ...newSlide,
          diagram: newSlide.diagram ?? old?.diagram,
          mermaidBlock: newSlide.mermaidBlock ?? old?.mermaidBlock,
        },
        "commit", // AI edit = one discrete undo step
      );
    },
    [deck, activeSlide, handleSlideUpdate],
  );

  // Markdown of the active slide → AI panel "this slide" + the Markdown view.
  // Serialize with the slide's RESOLVED layout: a lone slide is index 0, and
  // autoSelectLayout's "first slide → Title" rule would otherwise mangle a
  // content slide into Title format. Pinning the resolved layout keeps it correct.
  // Template capability summary handed to the deck-generation AI (kinds/columns/capacity).
  const deckHint = useMemo(() => (catalog ? deckCapabilities(catalog) : undefined), [catalog]);

  const currentSlideMd = (() => {
    const s = deck?.slides[activeSlide];
    if (!s) return undefined;
    const resolved = s.layout === "auto" ? autoSelectLayout(s, activeSlide, deck!.slides.length, catalog) : s.layout;
    return serializeMd({ slides: [{ ...s, layout: resolved }] });
  })();

  // Per-slide Markdown editing: the Markdown is the full source for this slide,
  // so parse it and replace the active slide (coalesced for live typing).
  const handleSlideMdChange = useCallback(
    (md: string) => {
      if (!deck) return;
      const newSlide = parseMd(md).slides[0];
      if (!newSlide) return;
      handleSlideUpdate(activeSlide, newSlide, "coalesce");
    },
    [deck, activeSlide, handleSlideUpdate],
  );

  // Get current slide's layout info for editor
  const currentSlide = deck?.slides[activeSlide];
  const currentLayoutName = currentSlide
    ? currentSlide.layout === "auto"
      ? autoSelectLayout(currentSlide, activeSlide, deck!.slides.length, catalog)
      : currentSlide.layout
    : undefined;
  const currentLayout = currentLayoutName && templateData
    ? findLayout(templateData, currentLayoutName)
    : undefined;

  // ── Cursor line → active slide ──
  const handleCursorLine = useCallback(
    (line: number) => {
      if (!deck) return;
      for (let i = deck.slides.length - 1; i >= 0; i--) {
        const s = deck.slides[i];
        if (s.sourceLineStart && line >= s.sourceLineStart) {
          setActiveSlide(i);
          return;
        }
      }
      setActiveSlide(0);
    },
    [deck],
  );

  // ── Preview click → editor jump ──
  const handleSlideClick = useCallback(
    (index: number) => {
      setActiveSlide(index);
      if (!deck) return;
      const slide = deck.slides[index];
      if (slide?.sourceLineStart) {
        setGotoLine({ line: slide.sourceLineStart, ts: Date.now() });
      }
    },
    [deck],
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt"
        className="hidden"
        onChange={handleFileSelected}
      />
      <input
        ref={templateInputRef}
        type="file"
        accept=".pptx"
        className="hidden"
        onChange={handleTemplateSelected}
      />

      <div className="flex items-center">
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
        <div className="flex items-center gap-2 px-3 py-2 bg-[#1E2761] border-b border-[#3B82F6]/30">
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
        </div>
      </div>

      {/* ── Markdown editor + live preview ── */}
      {subMode === "import" && (
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
              currentDiagramYaml={currentDiagramYaml}
              onApplyDiagram={handleDiagramChange}
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
