/**
 * useDeckController.ts — All App-level state, effects and action handlers for the
 * deck (parse/distill, file/template IO, PPTX generation, slide + diagram editing,
 * AI apply, undo/redo). Extracted from App.tsx so that file stays a thin view
 * within the 400-line rule (R1). App.tsx renders; this hook owns the behaviour.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { type HistoryMode } from "./useHistoryState";
import { useDocumentStore } from "./useDocumentStore";
import { buildCatalog, deckCapabilities } from "../engine/template-catalog";
import { distillDeck } from "../engine/distill";
import { validateDiagramSource } from "../engine/mermaid-to-diagram";
import { parseDesignIntent, applyDesignIntent } from "../engine/design-intent";
import { parseMd } from "../engine/md-parser";
import { serializeMd } from "../engine/md-serializer";
import { loadTemplate, autoSelectLayout, findLayout } from "../engine/template-loader";
import type { DeckIR, SlideIR } from "../engine/slide-schema";
import { pickBinaryFile } from "../ipc/commands";
import { useDeckRevise } from "./useDeckRevise";
import { useDeckIO } from "./useDeckIO";
import { visualizeKeyValueMd } from "../engine/slide-rewrite";
import { SAMPLE_MD } from "../sample-deck";

export type { MarkdownSubMode } from "./useDocumentStore";

export function useDeckController() {
  // Edit (visual) is the home/main surface; Import is the one-time "Initialize"
  // phase (bring content → fix slide division + rough content → 確定 → Edit).
  // Global UI prefs (NOT per-document) stay as plain local state.
  const [showLlmAssist, setShowLlmAssist] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  // Edit-mode center pane: structured form vs raw per-slide Markdown.
  const [slideEditView, setSlideEditView] = useState<"form" | "markdown">("form");

  // Per-document state lives in the multi-document store; this binds to the ACTIVE
  // document and re-exposes the same flat API the controller always had (deck = the
  // single source of truth for the active doc; undo/redo, selection, mdText, template
  // are all per-document so opening a 2nd project never destroys the 1st).
  const {
    deck, setDeck, resetDeck, undoDeck, redoDeck, canUndo, canRedo,
    mdText, setMdText, templateData, setTemplateData, templateName, setTemplateName,
    parseError, setParseError, activeSlide, setActiveSlide, selected, setSelected,
    gotoLine, setGotoLine, subMode, setSubMode, filePath, setFilePath,
    docs, activeId, createDoc, openDoc, switchDoc, closeDoc,
  } = useDocumentStore({ mdText: SAMPLE_MD, templateName: "Midnight Executive", subMode: "edit", selected: new Set([0]), title: "サンプル" });

  // Catalog → layout selection + capacity adapt to the loaded template (canonical = unchanged).
  const catalog = useMemo(() => (templateData ? buildCatalog(templateData) : undefined), [templateData]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Markdown mode: parse MD ──
  // mode controls undo history: "silent" = editor typing (text owns its undo),
  // "reset" = brand-new deck (file/AI-deck import), "commit" = undoable load.
  const clearParse = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  // Parse + distill + commit synchronously (the body of the debounced parse). Reused
  // to FLUSH a pending parse on 確定 so the committed deck matches the visible Markdown.
  const commitParse = useCallback(
    (text: string, mode: HistoryMode | "reset") => {
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
    },
    [setDeck, resetDeck, catalog, setParseError],
  );

  const parseMdText = useCallback(
    (text: string, mode: HistoryMode | "reset" = "silent") => {
      clearParse();
      debounceRef.current = setTimeout(() => commitParse(text, mode), 300);
    },
    [clearParse, commitParse],
  );

  // ── Editor change handlers ──
  const handleEditorChange = useCallback(
    (value: string) => {
      setMdText(value);
      parseMdText(value);
    },
    [parseMdText, setMdText],
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
  }, [setTemplateData, setTemplateName, setParseError]);

  // File & PPTX I/O (open / save / generate / project) — split out to keep this ≤400 (R1).
  const { generating, handleOpen, handleSave, handleGenerate, handleSaveProject, handleOpenProject } = useDeckIO({
    mdText, deck, templateData, parseMdText, setMdText, setParseError,
    templateName, filePath, setFilePath, openDoc,
  });

  const hasContent = deck !== null && templateData !== null;


  // ── LLM Assist: import result ──
  const handleLlmImport = useCallback(
    (text: string) => {
      setMdText(text);
      parseMdText(text, "reset");
      setSubMode("import");
    },
    [parseMdText, setMdText, setSubMode],
  );

  // AI panel "適用"（デッキ全体）: replace the deck but stay in Edit to keep refining.
  const handleAiApply = useCallback(
    (md: string) => {
      setMdText(md);
      parseMdText(md, "commit");
      setActiveSlide(0);
      setSelected(new Set([0])); // reset selection on a fresh deck
      setSubMode("edit");
    },
    [parseMdText, setMdText, setActiveSlide, setSelected, setSubMode],
  );

  // ── Initialize (Import) ⇄ Edit ──
  // Snapshot of the deck when the Initialize modal opens — used by 確定 (as the undo
  // baseline) and キャンセル (to restore). Declared before the handlers that read it.
  const initSnapshotRef = useRef<DeckIR | null>(null);

  // 確定 → Edit: FLUSH any pending debounced parse so the committed deck matches the
  // visible Markdown, and record the whole Initialize as ONE undo step (snapshot →
  // result), then work visually (deck = source of truth).
  const handleStartEditing = useCallback(() => {
    if (!deck) return; // 確定 is disabled when the Markdown doesn't parse
    clearParse();
    try {
      const parsed = mdText.trim() ? parseMd(mdText) : null;
      const fitted = parsed && catalog ? distillDeck(parsed, catalog) : parsed;
      if (!fitted) return;
      setDeck(initSnapshotRef.current, "silent"); // present = pre-Initialize…
      setDeck(fitted, "commit"); // …then one undoable step to the committed result
      setParseError(null);
      setSubMode("edit");
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e)); // stay in Initialize
    }
  }, [deck, mdText, catalog, clearParse, setDeck, setParseError, setSubMode]);

  // Open the Initialize phase (modal): serialize the CURRENT deck back to Markdown so
  // it reflects the live deck (deck = truth), and snapshot the deck so キャンセル can
  // discard whatever the modal's live edits did. Guarded so re-opening mid-edit is safe.
  const handleEnterImport = useCallback(() => {
    if (subMode === "edit") {
      initSnapshotRef.current = deck;
      if (deck) setMdText(serializeMd(deck));
    }
    setSubMode("import");
  }, [subMode, deck, setMdText, setSubMode]);

  // Cancel Initialize: kill any pending parse (so a trailing debounce can't re-apply
  // the discarded edits), restore the deck AND mdText to the pre-open snapshot, → Edit.
  const handleCancelInitialize = useCallback(() => {
    clearParse();
    const snap = initSnapshotRef.current;
    setDeck(snap, "silent");
    setMdText(snap ? serializeMd(snap) : "");
    setParseError(null);
    setSubMode("edit");
  }, [clearParse, setDeck, setMdText, setParseError, setSubMode]);

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

  // Deterministic "→表" in Edit (deck = source of truth): serialize the slide →
  // visualize key-value bullets → parse back → replace the slide (deck-op, undoable).
  // Reuses the same markdown lever as Import, so Initialize/Edit stay consistent.
  const handleVisualizeSlide = useCallback(
    (slideIndex: number) => {
      const cur = deckRef.current;
      const slide = cur?.slides[slideIndex];
      if (!slide) return;
      const resolved = slide.layout === "auto" ? autoSelectLayout(slide, slideIndex, cur!.slides.length, catalog) : slide.layout;
      const fixed = visualizeKeyValueMd(serializeMd({ slides: [{ ...slide, layout: resolved }] }));
      if (!fixed) return;
      const newSlide = parseMd(fixed).slides[0];
      if (newSlide) handleSlideUpdate(slideIndex, newSlide, "commit");
    },
    [catalog, handleSlideUpdate],
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
    [deck, activeSlide, handleSlideUpdate, setParseError],
  );

  // Markdown of the active slide → AI panel "this slide" + the Markdown view.
  // Serialize with the slide's RESOLVED layout: a lone slide is index 0, and
  // autoSelectLayout's "first slide → Title" rule would otherwise mangle a
  // content slide into Title format. Pinning the resolved layout keeps it correct.
  // Template capability summary handed to the deck-generation AI (kinds/columns/capacity).
  const deckHint = useMemo(() => (catalog ? deckCapabilities(catalog) : undefined), [catalog]);

  // The 整形 (distill) cluster: review + manuscript structuring + per-issue fixes.
  const { diagnostics, contentBox, activeSlideIssues, handleStructureManuscript, handleFixIssue } = useDeckRevise({
    mdText, setMdText, parseMdText, deck, catalog, activeSlide,
  });

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
    [deck, setActiveSlide],
  );

  // Slide-list selection: plain = single, ⌘/Ctrl = toggle, Shift = range from the focus
  // anchor. Updates the focused slide + the highlighted set.
  const selectSlide = useCallback(
    (index: number, mods?: { shift?: boolean; meta?: boolean }) => {
      const count = deck?.slides.length ?? 0;
      if (index < 0 || index >= count) return;
      setSelected((prev) => {
        if (mods?.meta) {
          const next = new Set(prev);
          if (next.has(index) && next.size > 1) next.delete(index);
          else next.add(index);
          return next;
        }
        if (mods?.shift) {
          const next = new Set<number>();
          for (let i = Math.min(activeSlide, index); i <= Math.max(activeSlide, index); i++) next.add(i);
          return next;
        }
        return new Set([index]);
      });
      setActiveSlide(index);
    },
    [deck, activeSlide, setSelected, setActiveSlide],
  );

  // ── Preview click → editor jump ──
  const handleSlideClick = useCallback(
    (index: number) => {
      setActiveSlide(index);
      setSelected(new Set([index]));
      if (!deck) return;
      const slide = deck.slides[index];
      if (slide?.sourceLineStart) {
        setGotoLine({ line: slide.sourceLineStart, ts: Date.now() });
      }
    },
    [deck, setActiveSlide, setSelected, setGotoLine],
  );

  return {
    subMode, setSubMode, showLlmAssist, setShowLlmAssist, showAiPanel, setShowAiPanel,
    slideEditView, setSlideEditView, mdText, deck, templateData, parseError, generating,
    filePath, activeSlide, setActiveSlide, selected, selectSlide, gotoLine, templateName,
    undoDeck, redoDeck, canUndo, canRedo, handleEditorChange, handleLoadTemplate,
    handleOpen, handleSave, handleGenerate, handleSaveProject, handleOpenProject, hasContent,
    handleLlmImport, handleAiApply, handleStartEditing, handleEnterImport, handleCancelInitialize, handleStructureManuscript, handleSlideUpdate,
    handleDiagramChange, handleApplySlide, deckHint, diagnostics, contentBox, activeSlideIssues, handleFixIssue, handleVisualizeSlide, currentSlideMd, handleSlideMdChange,
    currentSlide, currentLayoutName, currentLayout, handleCursorLine, handleSlideClick,
    catalog, setDeck, // exposed for the App-level refine loop (useDeckRefine)
    docs, activeId, createDoc, switchDoc, closeDoc, // multi-document collection (tabs, P0.2)
  };
}
