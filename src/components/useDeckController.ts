/**
 * useDeckController.ts — All App-level state, effects and action handlers for the
 * deck (parse/distill, file/template IO, PPTX generation, slide + diagram editing,
 * AI apply, undo/redo). Extracted from App.tsx so that file stays a thin view
 * within the 400-line rule (R1). App.tsx renders; this hook owns the behaviour.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useHistoryState, type HistoryMode } from "./useHistoryState";
import { buildCatalog, deckCapabilities } from "../engine/template-catalog";
import { distillDeck } from "../engine/distill";
import { validateDiagramSource } from "../engine/mermaid-to-diagram";
import { parseDesignIntent, applyDesignIntent } from "../engine/design-intent";
import { parseMd } from "../engine/md-parser";
import { serializeMd } from "../engine/md-serializer";
import { loadTemplate, type TemplateData, autoSelectLayout, findLayout } from "../engine/template-loader";
import type { DeckIR, SlideIR } from "../engine/slide-schema";
import { pickTextFile, pickBinaryFile, saveBinaryFile, saveTextFile } from "../ipc/commands";
import { renderDeckToPptxBytes } from "./deck-export";
import { SAMPLE_MD } from "../sample-deck";

export type MarkdownSubMode = "import" | "edit";

export function useDeckController() {
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

  // Load a custom template (.pptx) — native Open dialog on desktop, file picker in browser
  const handleLoadTemplate = useCallback(async () => {
    const picked = await pickBinaryFile(["pptx"], "PowerPoint");
    if (!picked) return;
    try {
      const tpl = await loadTemplate(picked.bytes.buffer as ArrayBuffer);
      setTemplateData(tpl);
      setTemplateName(picked.name.replace(/\.pptx$/i, ""));
    } catch (err) {
      setParseError(`Template load failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // Open a Markdown file
  const handleOpen = useCallback(async () => {
    const picked = await pickTextFile();
    if (!picked) return;
    setMdText(picked.content);
    parseMdText(picked.content, "reset");
    setFilePath(picked.name);
  }, [parseMdText]);

  // Save the Markdown source
  const handleSave = useCallback(() => {
    void saveTextFile(mdText, filePath ?? "slidecraft.md");
  }, [mdText, filePath]);

  // Generate + save the .pptx (mermaid pre-render + WYSIWYG rasterise in deck-export.ts)
  const handleGenerate = useCallback(async () => {
    if (!deck || !templateData) return;
    setGenerating(true);
    try {
      const bytes = await renderDeckToPptxBytes(deck, templateData);
      await saveBinaryFile(bytes, "slides_output.pptx", ["pptx"], "PowerPoint");
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


  // AI panel "適用"（このスライドだけ）: parse the one edited slide and replace only
  // the active slide, preserving any diagram/mermaid the text edit doesn't carry.
  const handleApplySlide = useCallback(
    (raw: string) => {
      if (!deck) return;
      const old = deck.slides[activeSlide];
      // ② Design edit: the model returned a DesignIntent (spatial) instead of Markdown.
      // The engine maps it to clamped geometry on the current slide.
      const intent = parseDesignIntent(raw);
      if (intent && old) {
        handleSlideUpdate(activeSlide, applyDesignIntent(old, intent), "commit");
        return;
      }
      // ① Content edit (Markdown).
      const newSlide = parseMd(raw).slides[0];
      if (!newSlide) return;
      // Validate an edited figure (DiagramSpec YAML). If the model returned broken
      // YAML, keep the previous valid diagram + warn instead of rendering a broken one.
      let diagram = newSlide.diagram ?? old?.diagram;
      if (newSlide.diagram) {
        const err = validateDiagramSource(newSlide.diagram.yaml, "yaml");
        if (err) {
          diagram = old?.diagram;
          setParseError(`図の編集結果が不正なため、図は元のまま適用しました（${err}）`);
        }
      }
      handleSlideUpdate(
        activeSlide,
        {
          ...newSlide,
          diagram,
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

  return {
    subMode, setSubMode, showLlmAssist, setShowLlmAssist, showAiPanel, setShowAiPanel,
    slideEditView, setSlideEditView, mdText, deck, templateData, parseError, generating,
    filePath, activeSlide, setActiveSlide, gotoLine, templateName,
    undoDeck, redoDeck, canUndo, canRedo, handleEditorChange, handleLoadTemplate,
    handleOpen, handleSave, handleGenerate, hasContent,
    handleLlmImport, handleAiApply, handleStartEditing, handleExportMd, handleSlideUpdate,
    handleDiagramChange, handleApplySlide, deckHint, currentSlideMd, handleSlideMdChange,
    currentSlide, currentLayoutName, currentLayout, handleCursorLine, handleSlideClick,
  };
}
