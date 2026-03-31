import { useState, useCallback, useRef } from "react";
import yaml from "js-yaml";
import Editor from "./components/Editor";
import Preview from "./components/Preview";
import SlidePreview from "./components/SlidePreview";
import SlideList from "./components/SlideList";
import SlideEditor from "./components/SlideEditor";
import Toolbar from "./components/Toolbar";
import ThemePicker from "./components/ThemePicker";
import StatusBar from "./components/StatusBar";
import { DiagramSpecSchema, validateDiagramSpec, type DiagramSpec } from "./engine/schema";
import { renderToBuffer } from "./engine/pptx-writer";
import { midnightExecutive } from "./engine/theme";
import { parseMd } from "./engine/md-parser";
import { serializeMd } from "./engine/md-serializer";
import { loadTemplate, type TemplateData, autoSelectLayout, findLayout } from "./engine/template-loader";
import { generatePptx } from "./engine/placeholder-filler";
import type { DeckIR, SlideIR } from "./engine/slide-schema";
import { readFileFromInput, downloadBlob } from "./ipc/commands";

type AppMode = "diagram" | "markdown";
type MarkdownSubMode = "import" | "edit";

const SAMPLE_YAML = `type: flowchart
direction: TB
title: API認証フロー

classDefs:
  process:
    fill: "#1E2761"
    border: "#3B82F6"
    font_color: "#FFFFFF"
  decision:
    fill: "#F59E0B"
    font_color: "#1E293B"
    font_size: 10
  terminal:
    fill: "#3B82F6"

nodes:
  - id: start
    label: 開始
    shape: rounded_rect
    class: terminal
  - id: proc1
    label: リクエスト受付
    class: process
  - id: auth
    label: 認証OK？
    shape: diamond
    class: decision
  - id: ok
    label: データ処理
    class: process
  - id: ng
    label: エラー返却
    class: process
  - id: end
    label: 終了
    shape: rounded_rect
    class: terminal

edges:
  - from: start
    to: proc1
  - from: proc1
    to: auth
  - from: auth
    to: ok
    label: "Yes"
  - from: auth
    to: ng
    label: "No"
  - from: ok
    to: end
  - from: ng
    to: end
`;

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
  const [mode, setMode] = useState<AppMode>("markdown");
  const [subMode, setSubMode] = useState<MarkdownSubMode>("import");
  const [yamlText, setYamlText] = useState(SAMPLE_YAML);
  const [mdText, setMdText] = useState(SAMPLE_MD);
  const [spec, setSpec] = useState<DiagramSpec | null>(null);
  const [deck, setDeck] = useState<DeckIR | null>(null);
  const [templateData, setTemplateData] = useState<TemplateData | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [themeName, setThemeName] = useState("midnight_executive");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [gotoLine, setGotoLine] = useState<{ line: number; ts: number } | undefined>(undefined);
  const [templateName, setTemplateName] = useState("Midnight Executive");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Diagram mode: parse YAML ──
  const parseYaml = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        if (!text.trim()) {
          setSpec(null);
          setParseError(null);
          return;
        }
        const data = yaml.load(text);
        if (!data || typeof data !== "object") {
          setParseError("YAML must produce an object");
          setSpec(null);
          return;
        }
        const result = DiagramSpecSchema.safeParse(data);
        if (!result.success) {
          setParseError(result.error.issues.map((i: { message: string }) => i.message).join("\n"));
          setSpec(null);
          return;
        }
        const errors = validateDiagramSpec(result.data);
        if (errors.length > 0) {
          setParseError(errors.map((e) => e.message).join("\n"));
          setSpec(null);
          return;
        }
        setSpec(result.data);
        setParseError(null);
      } catch (e) {
        setParseError(e instanceof Error ? e.message : String(e));
        setSpec(null);
      }
    }, 300);
  }, []);

  // ── Markdown mode: parse MD ──
  const parseMdText = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        if (!text.trim()) {
          setDeck(null);
          setParseError(null);
          return;
        }
        const parsed = parseMd(text);
        setDeck(parsed);
        setParseError(null);
      } catch (e) {
        setParseError(e instanceof Error ? e.message : String(e));
        setDeck(null);
      }
    }, 300);
  }, []);

  // ── Editor change handlers ──
  const handleEditorChange = useCallback(
    (value: string) => {
      if (mode === "diagram") {
        setYamlText(value);
        parseYaml(value);
      } else {
        setMdText(value);
        parseMdText(value);
      }
    },
    [mode, parseYaml, parseMdText],
  );

  // Initial parse (no debounce) + template load
  useState(() => {
    // Parse both immediately without debounce
    try {
      const data = yaml.load(SAMPLE_YAML);
      if (data && typeof data === "object") {
        const result = DiagramSpecSchema.safeParse(data);
        if (result.success) setSpec(result.data);
      }
    } catch { /* ignore */ }
    try {
      setDeck(parseMd(SAMPLE_MD));
    } catch { /* ignore */ }
    // Load template for preview
    fetch("/templates/slide/Midnight_Executive_30_TemplateOnly.pptx")
      .then((r) => r.arrayBuffer())
      .then((buf) => loadTemplate(buf))
      .then(setTemplateData)
      .catch(() => {});
  });

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
      if (mode === "diagram") {
        setYamlText(text);
        parseYaml(text);
      } else {
        setMdText(text);
        parseMdText(text);
      }
      setFilePath(file.name);
      e.target.value = "";
    },
    [mode, parseYaml, parseMdText],
  );

  // Save
  const handleSave = useCallback(() => {
    const text = mode === "diagram" ? yamlText : mdText;
    const mimeType = mode === "diagram" ? "text/yaml" : "text/markdown";
    const ext = mode === "diagram" ? ".yaml" : ".md";
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filePath ?? `slidecraft${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [mode, yamlText, mdText, filePath]);

  // Generate PPTX
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      if (mode === "diagram") {
        if (!spec) return;
        const theme = midnightExecutive();
        const buffer = await renderToBuffer(spec, { theme });
        const filename = spec.title
          ? `${spec.title.replace(/[^\w\s-]/g, "").trim()}.pptx`
          : "diagram_output.pptx";
        downloadBlob(buffer, filename);
      } else {
        if (!deck || !templateData) return;
        // Pre-render mermaid SVGs for PPTX embedding
        const { default: mermaidLib } = await import("mermaid");
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
        const buffer = await generatePptx(deckWithSvg, templateData);
        downloadBlob(buffer as unknown as Uint8Array, "slides_output.pptx");
      }
    } catch (e) {
      setParseError(`PPTX generation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  }, [mode, spec, deck, templateData]);

  const hasContent = mode === "diagram" ? spec !== null : (deck !== null && templateData !== null);


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
    (index: number, updated: SlideIR) => {
      if (!deck) return;
      const newSlides = [...deck.slides];
      newSlides[index] = updated;
      setDeck({ ...deck, slides: newSlides });
    },
    [deck],
  );

  // Get current slide's layout info for editor
  const currentSlide = deck?.slides[activeSlide];
  const currentLayoutName = currentSlide
    ? currentSlide.layout === "auto"
      ? autoSelectLayout(currentSlide, activeSlide, deck!.slides.length)
      : currentSlide.layout
    : undefined;
  const currentLayout = currentLayoutName && templateData
    ? findLayout(templateData, currentLayoutName)
    : undefined;

  // ── Cursor line → active slide ──
  const handleCursorLine = useCallback(
    (line: number) => {
      if (mode !== "markdown" || !deck) return;
      for (let i = deck.slides.length - 1; i >= 0; i--) {
        const s = deck.slides[i];
        if (s.sourceLineStart && line >= s.sourceLineStart) {
          setActiveSlide(i);
          return;
        }
      }
      setActiveSlide(0);
    },
    [mode, deck],
  );

  // ── Preview click → editor jump ──
  const handleSlideClick = useCallback(
    (index: number) => {
      setActiveSlide(index);
      if (mode !== "markdown" || !deck) return;
      const slide = deck.slides[index];
      if (slide?.sourceLineStart) {
        setGotoLine({ line: slide.sourceLineStart, ts: Date.now() });
      }
    },
    [mode, deck],
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={mode === "diagram" ? ".yaml,.yml,.json" : ".md,.markdown,.txt"}
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
          generating={generating}
          hasSpec={hasContent}
          templateName={templateName}
          mode={mode}
        />
        <div className="flex items-center gap-2 px-3 py-2 bg-[#1E2761] border-b border-[#3B82F6]/30">
          {/* Mode toggle */}
          <div className="flex rounded overflow-hidden border border-[#3B82F6]/40 text-xs">
            <button
              onClick={() => { setMode("diagram"); parseYaml(yamlText); }}
              className={`px-3 py-1 transition-colors ${
                mode === "diagram"
                  ? "bg-[#3B82F6] text-white"
                  : "bg-[#1E2761] text-gray-400 hover:text-white"
              }`}
            >
              Diagram
            </button>
            <button
              onClick={() => { setMode("markdown"); parseMdText(mdText); }}
              className={`px-3 py-1 transition-colors ${
                mode === "markdown"
                  ? "bg-[#3B82F6] text-white"
                  : "bg-[#1E2761] text-gray-400 hover:text-white"
              }`}
            >
              Markdown
            </button>
          </div>
          {mode === "diagram" && (
            <ThemePicker currentTheme={themeName} onThemeChange={setThemeName} />
          )}
          {mode === "markdown" && (
            <div className="flex rounded overflow-hidden border border-[#3B82F6]/40 text-xs ml-2">
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
          )}
        </div>
      </div>

      {/* ── Diagram mode (legacy) ── */}
      {mode === "diagram" && (
        <div className="flex-1 flex min-h-0">
          <div className="w-1/2 border-r border-[#2D3A6E] flex flex-col min-h-0">
            <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">
              YAML Editor
            </div>
            <div className="flex-1 min-h-0">
              <Editor value={yamlText} onChange={handleEditorChange} language="yaml" />
            </div>
          </div>
          <div className="w-1/2 flex flex-col min-h-0 bg-[#0f1117]">
            <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">
              Mermaid Preview
            </div>
            <div className="flex-1 min-h-0">
              <Preview spec={spec} error={parseError} />
            </div>
          </div>
        </div>
      )}

      {/* ── Markdown Import mode ── */}
      {mode === "markdown" && subMode === "import" && (
        <div className="flex-1 flex min-h-0">
          <div className="w-1/2 border-r border-[#2D3A6E] flex flex-col min-h-0">
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
          </div>
          <div className="w-1/2 flex flex-col min-h-0 bg-[#0f1117]">
            <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">
              Slide Preview
            </div>
            <div className="flex-1 min-h-0">
              <SlidePreview
                deck={deck}
                template={templateData}
                error={parseError}
                activeSlide={activeSlide}
                onSlideClick={handleSlideClick}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Markdown Edit mode (3-pane) ── */}
      {mode === "markdown" && subMode === "edit" && (
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

          {/* Center: Slide editor */}
          <div className="flex-1 border-r border-[#2D3A6E] flex flex-col min-h-0 bg-[#0f1117]">
            <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">
              Slide Editor — {currentLayoutName || "No slide"}
            </div>
            <div className="flex-1 min-h-0">
              {currentSlide ? (
                <SlideEditor
                  slide={currentSlide}
                  layout={currentLayout}
                  onChange={(updated) => handleSlideUpdate(activeSlide, updated)}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                  Select a slide
                </div>
              )}
            </div>
          </div>

          {/* Right: Single slide preview */}
          <div className="w-[45%] flex flex-col min-h-0 bg-[#0f1117]">
            <div className="px-3 py-1 bg-[#141B41] text-xs text-gray-400 border-b border-[#2D3A6E]">
              Preview — Slide {activeSlide + 1}
            </div>
            <div className="flex-1 min-h-0">
              <SlidePreview
                deck={deck}
                template={templateData}
                error={parseError}
                activeSlide={activeSlide}
                singleSlide
              />
            </div>
          </div>
        </div>
      )}

      <StatusBar spec={spec} error={parseError} filePath={filePath} />
    </>
  );
}
