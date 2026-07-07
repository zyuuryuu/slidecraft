/**
 * useDeckController.ts — All App-level state, effects and action handlers for the
 * deck (parse/distill, file/template IO, PPTX generation, slide + diagram editing,
 * AI apply, undo/redo). Extracted from App.tsx so that file stays a thin view
 * within the 400-line rule (R1). App.tsx renders; this hook owns the behaviour.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { type HistoryMode } from "./useHistoryState";
import { useDocumentStore } from "./useDocumentStore";
import { buildCatalog, deckCapabilities, assessTemplateHealth } from "../engine/template-catalog";
import { distillDeck } from "../engine/distill";
import { parseDesignIntent, applyDesignIntentReport } from "../engine/design-intent";
import { parseDiagramEditOps, applyDiagramEditOps, checkDeleteIntent, buildOpsRetryInstruction } from "../engine/diagram-edit-ops";
import { applyFigureYaml, previewFigureEdit, figureFence, reconcileSlideEdit, figureFallbackTag } from "../engine/ai-apply";
import { blankSlide, insertSlideAt, deleteSlideAt, duplicateSlideAt, moveSlideTo, slideHasContent } from "../engine/deck-structure";
import { parseMd } from "../engine/md-parser";
import { serializeMd } from "../engine/md-serializer";
import { loadTemplate, autoSelectLayout, suggestLayouts, findLayout } from "../engine/template-loader";
import { applyTemplateBytes, applyTemplateBytesWithRepair, applyTemplateBytesAsRemake } from "./apply-template";
import type { RepairPlan } from "../engine/template-repair";
import type { DeckIR, SlideIR, ImageRect } from "../engine/slide-schema";
import { pickBinaryFile } from "../ipc/commands";
import { useDeckRevise } from "./useDeckRevise";
import { useDeckIO } from "./useDeckIO";
import { visualizeKeyValueMd } from "../engine/slide-rewrite";
import { SAMPLE_MD } from "../sample-deck";

export type { MarkdownSubMode } from "./useDocumentStore";

/** P2.5 collaboration bridge App injects when connected — per-slide edits + Undo/Redo are routed to
 *  the host (the single truth) instead of mutating local state. Null when not collaborating. */
export interface CollabBridge {
  sendSlideMarkdown(index: number, markdown: string): Promise<{ ok: boolean; stale?: boolean; message?: string }>;
  serverUndo(): Promise<{ ok: boolean; reason?: string }>;
  serverRedo(): Promise<{ ok: boolean; reason?: string }>;
  notify(message: string): void;
}

/** Observe-only: while `editLockedRef.current` is true (App syncs it from collab.status each render),
 *  EVERY local deck-mutation entry point here no-ops — the host is the single truth and the
 *  projection's applyDeck (in App, NOT routed through here) is the only writer. Gates live in this
 *  handler layer, never in setDeck/the reducer (that would freeze the projection too). The ref is
 *  RETURNED so App drives it; a ref (not a prop) so handlers/effects read the latest without re-subscribing. */
export function useDeckController() {
  // Edit (visual) is the home/main surface; Import is the one-time "Initialize"
  // phase (bring content → fix slide division + rough content → 確定 → Edit).
  // Global UI prefs (NOT per-document) stay as plain local state.
  const [showLlmAssist, setShowLlmAssist] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  // Edit-mode center pane: structured form vs raw per-slide Markdown.
  const [slideEditView, setSlideEditView] = useState<"form" | "markdown">("form");
  // Observe-only lock (App writes this from collab.status each render). Every mutation handler/effect
  // below reads `.current`; a useRef so the linter knows it's stable (no deps churn).
  const editLockedRef = useRef(false);
  // P2.5 round-trip bridge (App writes this when connected): per-slide edits + Undo/Redo route to the
  // host. Null when disconnected. A ref so handlers read the latest without re-subscribing.
  const collabRef = useRef<CollabBridge | null>(null);

  // Per-document state lives in the multi-document store; this binds to the ACTIVE
  // document and re-exposes the same flat API the controller always had (deck = the
  // single source of truth for the active doc; undo/redo, selection, mdText, template
  // are all per-document so opening a 2nd project never destroys the 1st).
  const {
    deck, setDeck, resetDeck, undoDeck, redoDeck, canUndo, canRedo,
    mdText, setMdText, templateData, setTemplateData, templateName, setTemplateName,
    parseError, setParseError, activeSlide, setActiveSlide, selected, setSelected,
    gotoLine, setGotoLine, subMode, setSubMode, filePath, setFilePath,
    docs, activeId, createDoc, openDoc, switchDoc, closeDoc, linkHostDoc,
  } = useDocumentStore({ mdText: SAMPLE_MD, templateName: "Midnight Executive", subMode: "edit", selected: new Set([0]), title: "サンプル" });

  // A NON-blocking advisory about the last applied AI edit (structure restored / numbers changed /
  // a broken figure kept as-is). Kept SEPARATE from parseError: the slide is valid and MUST still
  // render — this shows as a banner over the preview, not an error that blanks it.
  const [editNotice, setEditNotice] = useState<string | null>(null);

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
      if (editLockedRef.current) return; // observe-only: host = truth (covers every parseMdText caller)
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
      if (k !== "z" && k !== "y") return;
      e.preventDefault();
      const wantRedo = k === "y" || e.shiftKey;
      const bridge = editLockedRef.current ? collabRef.current : null;
      if (bridge) {
        // P2.5: reroute Undo/Redo to the host's server-side history (single truth).
        void (wantRedo ? bridge.serverRedo() : bridge.serverUndo()).then((r) => {
          if (!r.ok) bridge.notify(wantRedo ? "やり直せる操作がありません" : "戻せる操作がありません");
        });
      } else if (wantRedo) {
        redoDeck();
      } else {
        undoDeck();
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
    if (editLockedRef.current || !catalog || !deckRef.current) return; // observe-only: no indirect re-fit
    const fitted = distillDeck(deckRef.current, catalog);
    if (fitted.slides.length !== deckRef.current.slides.length) {
      setDeck(fitted, "silent");
    }
  }, [catalog, setDeck]);

  // Apply .pptx bytes as the active document's template, through the shared acceptance gate
  // (apply-template.ts). Reused by the top-bar loader AND the draft master picker (registry).
  const applyMasterBytes = useCallback(
    (buf: ArrayBuffer | Uint8Array, name: string) => applyTemplateBytes(buf, name, { setTemplateData, setTemplateName, setParseError }),
    [setTemplateData, setTemplateName, setParseError],
  );
  // 修復オファーつき（テーマ2 スライス1）: rejected でも修復可能なら confirm に諮り「整形して取り込む」。
  // インポート経路（新しい .pptx を取り込む時）だけが使う — レジストリ選択済みマスターは従来ゲートのまま。
  const applyMasterBytesWithRepair = useCallback(
    (buf: ArrayBuffer | Uint8Array, name: string, confirm: (plan: RepairPlan) => Promise<boolean>) =>
      applyTemplateBytesWithRepair(buf, name, { setTemplateData, setTemplateName, setParseError }, confirm),
    [setTemplateData, setTemplateName, setParseError],
  );
  // Re-make（第2の取り込み口）: 入力マスターのテーマ（フォント・配色）だけ抽出し SlideCraft 自前の
  // レイアウトで作り直す。第三者マスターの idx/テーマの癖（ADR-0023）を構造的に回避する。
  const applyMasterBytesAsRemake = useCallback(
    (buf: ArrayBuffer | Uint8Array, name: string) =>
      applyTemplateBytesAsRemake(buf, name, { setTemplateData, setTemplateName, setParseError }),
    [setTemplateData, setTemplateName, setParseError],
  );

  // Load a custom template (.pptx) — native Open dialog on desktop, file picker in browser
  const handleLoadTemplate = useCallback(async () => {
    if (editLockedRef.current) return; // observe-only: changing template would diverge from host
    const picked = await pickBinaryFile(["pptx"], "PowerPoint");
    if (!picked) return;
    await applyMasterBytes(picked.bytes.buffer as ArrayBuffer, picked.name);
  }, [applyMasterBytes]);

  // File & PPTX I/O (open / save / generate / project) — split out to keep this ≤400 (R1).
  const { generating, handleOpen, handleSave, handleGenerate, handleExportHtml, handleSaveProject, handleOpenProject } = useDeckIO({
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
    if (editLockedRef.current) return; // observe-only: Draft 確定 writes setDeck directly (bypasses commitParse)
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
    if (editLockedRef.current) return; // observe-only: restoring a stale snapshot would clobber host truth
    clearParse();
    const snap = initSnapshotRef.current;
    setDeck(snap, "silent");
    setMdText(snap ? serializeMd(snap) : "");
    setParseError(null);
    setSubMode("edit");
  }, [clearParse, setDeck, setMdText, setParseError, setSubMode]);

  // ── Slide editing: update a single slide in the deck ──
  // P2.5 round-trip: while collaborating, the edit is applied locally (optimistic) AND pushed to the
  // host. Typing ('coalesce') debounces into one send; a discrete 'commit' edit flushes immediately.
  const hostSendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // PER-INDEX buffer (NOT a single slot): editing slide A then slide B within the debounce window
  // must send BOTH — a single slot would drop A, silently diverging the host from the local deck.
  const pendingSend = useRef<Map<number, SlideIR>>(new Map());
  const flushHostSend = useCallback(async () => {
    if (hostSendTimer.current) {
      clearTimeout(hostSendTimer.current);
      hostSendTimer.current = null;
    }
    const bridge = collabRef.current;
    const pending = pendingSend.current;
    pendingSend.current = new Map();
    if (!bridge || pending.size === 0) return;
    const count = deckRef.current?.slides.length ?? 1;
    // Sequentially (not concurrently): each send advances the doc's rev, so concurrent sends would
    // make the second stale. Awaiting keeps every buffered slide's edit landing in order.
    for (const [index, slide] of pending) {
      const resolved = slide.layout === "auto" ? autoSelectLayout(slide, index, count, catalog) : slide.layout;
      const md = serializeMd({ slides: [{ ...slide, layout: resolved }] });
      const r = await bridge.sendSlideMarkdown(index, md);
      if (!r.ok) bridge.notify(r.message ?? "編集を host に送れませんでした");
    }
  }, [catalog]);
  const scheduleHostSend = useCallback(
    (index: number, slide: SlideIR, immediate: boolean) => {
      pendingSend.current.set(index, slide); // accumulate per index — no cross-slide edit is dropped
      if (hostSendTimer.current) clearTimeout(hostSendTimer.current);
      if (immediate) void flushHostSend();
      else hostSendTimer.current = setTimeout(() => void flushHostSend(), 600);
    },
    [flushHostSend],
  );
  const handleSlideUpdate = useCallback(
    (index: number, updated: SlideIR, mode: HistoryMode = "coalesce") => {
      if (!deck) return;
      const newSlides = [...deck.slides];
      newSlides[index] = updated;
      setDeck({ ...deck, slides: newSlides }, mode);
      if (editLockedRef.current) scheduleHostSend(index, updated, mode !== "coalesce"); // P2.5 round-trip
    },
    [deck, setDeck, scheduleHostSend],
  );

  // ── Slide STRUCTURE (add / delete / duplicate) — undo-able, via the shared deck-structure ops so the
  // GUI and MCP never diverge. Gated while collab-locked (observe-only: the host owns structure there). ──
  const handleAddSlide = useCallback(() => {
    if (editLockedRef.current || !deck) return;
    const { deck: next, at } = insertSlideAt(deck, activeSlide, blankSlide(), "after");
    setDeck(next, "commit");
    setActiveSlide(at);
    setSelected(new Set([at]));
    setEditNotice(null);
  }, [deck, activeSlide, setDeck, setActiveSlide, setSelected, setEditNotice]);

  const handleDeleteSlide = useCallback((index: number) => {
    if (editLockedRef.current || !deck) return;
    const next = deleteSlideAt(deck, index);
    if (!next) { setEditNotice("最後の1枚は削除できません（スライドは最低1枚必要です）。"); return; }
    setDeck(next, "commit");
    const focus = Math.min(index, next.slides.length - 1); // keep the selection on a valid slide
    setActiveSlide(focus);
    setSelected(new Set([focus]));
    setEditNotice(null);
  }, [deck, setDeck, setActiveSlide, setSelected, setEditNotice]);

  const handleDuplicateSlide = useCallback((index: number) => {
    if (editLockedRef.current || !deck) return;
    const { deck: next, newIndex } = duplicateSlideAt(deck, index, "after");
    setDeck(next, "commit");
    setActiveSlide(newIndex);
    setSelected(new Set([newIndex]));
    setEditNotice(null);
  }, [deck, setDeck, setActiveSlide, setSelected, setEditNotice]);

  // Drag-reorder: move slide `from` to position `to` (moveSlideTo = remove-then-insert; pure permutation,
  // figures/layouts byte-identical). Selection follows the moved slide. Disabled while collab observe-only.
  const handleMoveSlide = useCallback((from: number, to: number) => {
    if (editLockedRef.current || !deck || from === to) return;
    const next = moveSlideTo(deck, from, to);
    if (next === deck) return; // out-of-range / no-op
    setDeck(next, "commit");
    setActiveSlide(to);
    setSelected(new Set([to]));
    setEditNotice(null);
  }, [deck, setDeck, setActiveSlide, setSelected, setEditNotice]);

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

  // Insert a pasted/dropped image onto the CURRENT slide as its body figure (region 1). Replaces any
  // existing single-body figure there (only one fits) — undoable ("commit"). Disabled while collab observe-only.
  const handleInsertImage = useCallback((src: string, alt = "", aspect?: number) => {
    if (editLockedRef.current || !deck) return;
    const slide = deck.slides[activeSlide];
    if (!slide) return;
    // aspect (intrinsic w/h, measured at insert) enables aspect-lock resize + correct cover crop (案B).
    const aspectPart = aspect && aspect > 0 ? { aspect } : {};
    // If the slide ALREADY has content (text or a figure), don't destroy it: drop the image as a
    // BACKMOST layer (最背面) — a normal-sized figure in the body region, just BEHIND the content (not
    // full-bleed, not the slide background). An empty slide gets the image as its body figure instead.
    if (slideHasContent(slide)) {
      handleSlideUpdate(activeSlide, { ...slide, image: { src, alt, placeholderIdx: "1", behind: true, ...aspectPart } }, "commit");
      return;
    }
    const next: SlideIR = { ...slide, layout: "auto", image: { src, alt, placeholderIdx: "1", ...aspectPart } };
    delete next.diagram; delete next.mermaidBlock; delete next.table; delete next.code;
    handleSlideUpdate(activeSlide, next, "commit");
  }, [deck, activeSlide, handleSlideUpdate]);

  // Fine-tune the current image's geometry (案B, drag/resize on the preview or the numeric form). One
  // undoable commit per gesture — the preview keeps the in-flight rect locally, committing on release.
  const handleImageRectChange = useCallback((rect: ImageRect) => {
    if (editLockedRef.current || !deck) return;
    const slide = deck.slides[activeSlide];
    if (!slide?.image) return;
    handleSlideUpdate(activeSlide, { ...slide, image: { ...slide.image, rect } }, "commit");
  }, [deck, activeSlide, handleSlideUpdate]);


  // AI panel "適用"（このスライドだけ）: parse the one edited slide and replace only
  // the active slide, preserving any diagram/mermaid the text edit doesn't carry.
  const handleApplySlide = useCallback(
    // `instruction` (the user's request) is optional — when present it enables the delete-intent
    // cross-check on figure ops (a mistargeted delete is surfaced, never blocks). ADR-0019.
    (raw: string, instruction?: string) => {
      if (!deck) return;
      const old = deck.slides[activeSlide];
      // ⓪ Figure edit: AI mode "diagram-edit" returns a BARE DiagramSpec YAML (not Markdown). Apply
      // it straight to the slide's diagram — parsing it as Markdown yields no diagram, so the figure
      // edit would be silently dropped and the OLD diagram kept ("採用しても反映されない").
      if (old) {
        const fig = applyFigureYaml(old, raw);
        if (fig) { handleSlideUpdate(activeSlide, fig, "commit"); return; }
      }
      // ① Figure CONTENT ops (部分生成・ADR-0019): the model emitted a diagram-edit ops array (ONLY the
      // changed fields). Merge deterministically — untouched nodes/labels/values stay verbatim (drift ゼロ).
      // A skipped op (unknown id) is ANNOUNCED via editNotice, not silently dropped.
      if (old) {
        const editOps = parseDiagramEditOps(raw);
        if (editOps) {
          const { slide, skipped } = applyDiagramEditOps(old, editOps);
          // Skipped ops (unknown id) AND delete-intent advisories (a delete the instruction never named)
          // are ANNOUNCED via editNotice — never silent (ADR-0018/0019).
          const notices = [
            ...skipped.map((sk) => sk.message),
            ...(instruction ? checkDeleteIntent(old, editOps, instruction).map((a) => a.message) : []),
          ];
          setEditNotice(notices.length > 0 ? notices.join(" ｜ ") : null);
          handleSlideUpdate(activeSlide, slide, "commit");
          return;
        }
      }
      // ② Design edit: the model returned a DesignIntent (spatial) instead of Markdown.
      // The engine maps it to clamped geometry on the current slide, and reports any op that
      // couldn't take effect (e.g. an emphasize whose node id the AI renamed away) so it's ANNOUNCED
      // rather than a silent no-op (#13).
      const intent = parseDesignIntent(raw);
      if (intent && old) {
        const { slide, skipped } = applyDesignIntentReport(old, intent);
        // Advisory (an op couldn't take effect), NOT a fatal error — banner, don't blank the preview.
        setEditNotice(skipped.length > 0 ? skipped.map((sk) => sk.message).join(" ｜ ") : null);
        handleSlideUpdate(activeSlide, slide, "commit");
        return;
      }
      // ① Content edit (Markdown). Validation + reconcile were surfaced at the REVIEW step
      // (previewSlideEdit → the 変更プレビュー shows the reconciled result + its warnings), so the
      // reviewer decided 採用/却下 informed. Adoption just COMMITS that same reconciled slide — no
      // post-hoc validation, no blocking: an adopted slide is valid and always renders.
      if (!old) {
        const ns = parseMd(raw).slides[0];
        if (ns) handleSlideUpdate(activeSlide, ns, "commit");
        return;
      }
      const rec = reconcileSlideEdit(old, raw);
      if (!rec) return; // unparseable AI output — keep the slide as-is
      setEditNotice(null); // clear any stale advisory banner
      handleSlideUpdate(activeSlide, rec.slide, "commit"); // AI edit = one discrete undo step
    },
    [deck, activeSlide, handleSlideUpdate, setEditNotice],
  );

  // Preview an AI slide edit AS IT WILL BE APPLIED (reconciled) + its validation advisories, so the
  // 変更プレビュー shows the real result + warnings and the reviewer decides 採用/却下 informed. Only
  // the CONTENT-edit path reconciles; figure/design edits keep the raw diff (return null).
  const previewSlideEdit = useCallback(
    (raw: string, instruction?: string): { afterMd: string; warnings: string[]; beforeMd?: string; shouldRetry?: boolean; retryInstruction?: string } | null => {
      const s = deck?.slides[activeSlide];
      if (!s) return null;
      // Figure CONTENT ops (部分生成・ADR-0019): merge the ops, then diff the figure SOURCE (old vs
      // merged YAML) — same YAML-vs-YAML review as a bare-YAML figure edit. Surface skipped ops AND the
      // delete-intent advisory as warnings so the ops path's adoption gate is as informative as text's.
      const editOps = parseDiagramEditOps(raw);
      if (editOps) {
        const { slide: merged, skipped } = applyDiagramEditOps(s, editOps);
        const warnings = [
          ...skipped.map((sk) => sk.message),
          ...(instruction ? checkDeleteIntent(s, editOps, instruction).map((a) => a.message) : []),
        ];
        return { afterMd: figureFence(merged) ?? "", warnings, beforeMd: figureFence(s) ?? "" };
      }
      // Figure edit (bare DiagramSpec YAML): diff the figure SOURCE (YAML-vs-YAML), not the whole
      // slide's Markdown against raw YAML — the latter misaligns visually.
      const fig = previewFigureEdit(s, raw);
      if (fig) return { afterMd: fig.afterMd, warnings: [], beforeMd: fig.beforeMd };
      if (parseDesignIntent(raw)) return null; // design → raw diff
      const rec = reconcileSlideEdit(s, raw);
      if (!rec) return null;
      const resolved = autoSelectLayout(rec.slide, activeSlide, deck!.slides.length, catalog);
      // L4: a figure slide that fell to the full-Markdown path AND drifted → tag it so the "変更なし"
      // rollback is legible (the model regenerated the whole slide instead of emitting figure ops).
      const hadFigure = !!s.diagram || !!s.mermaidBlock;
      // ① Option A: that SAME condition (figure slide drifted to full-Markdown) is the deterministic
      // trigger for a single ops-bias auto-retry — AiPanel re-asks once for (B) ops. retryInstruction is
      // the harness-authored nudge (needs the original instruction; absent for batch/✨直す w/o one).
      const shouldRetry = hadFigure && rec.warnings.length > 0;
      return {
        afterMd: serializeMd({ slides: [{ ...rec.slide, layout: resolved }] }),
        warnings: figureFallbackTag(hadFigure, rec.warnings),
        ...(shouldRetry ? { shouldRetry, ...(instruction ? { retryInstruction: buildOpsRetryInstruction(s, instruction) } : {}) } : {}),
      };
    },
    [deck, activeSlide, catalog],
  );

  // Markdown of the active slide → AI panel "this slide" + the Markdown view.
  // Serialize with the slide's RESOLVED layout: a lone slide is index 0, and
  // autoSelectLayout's "first slide → Title" rule would otherwise mangle a
  // content slide into Title format. Pinning the resolved layout keeps it correct.
  // Template capability summary handed to the deck-generation AI (kinds/columns/capacity).
  // Pass the health status so a degraded master's hint warns the AI its metadata is partial.
  const deckHint = useMemo(
    () => (catalog ? deckCapabilities(catalog, assessTemplateHealth(catalog).status) : undefined),
    [catalog],
  );

  // The 整形 (distill) cluster: review + manuscript structuring + per-issue fixes.
  const { diagnostics, contentBox, activeSlideIssues, handleStructureManuscript, handleFixIssue } = useDeckRevise({
    mdText, setMdText, parseMdText, deck, catalog, activeSlide,
  });

  const currentSlideMd = (() => {
    const s = deck?.slides[activeSlide];
    if (!s) return undefined;
    // Resolve unconditionally: a pinned name this template lacks degrades to a real layout (so the
    // cover's canonical pin doesn't leave the editor/preview layout-less on an alien master).
    const resolved = autoSelectLayout(s, activeSlide, deck!.slides.length, catalog);
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
    ? autoSelectLayout(currentSlide, activeSlide, deck!.slides.length, catalog)
    : undefined;
  const currentLayout = currentLayoutName && templateData
    ? findLayout(templateData, currentLayoutName)
    : undefined;
  // Ranked layout candidates for the editor's "Auto → X, also try:" chips (auto pick first).
  const layoutSuggestions = currentSlide && catalog
    ? suggestLayouts(currentSlide, activeSlide, deck!.slides.length, catalog, 4)
    : [];

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
    slideEditView, setSlideEditView, mdText, deck, templateData, parseError, editNotice, setEditNotice, generating,
    filePath, activeSlide, setActiveSlide, selected, selectSlide, gotoLine, templateName,
    undoDeck, redoDeck, canUndo, canRedo, handleEditorChange, handleLoadTemplate, applyMasterBytes, applyMasterBytesWithRepair, applyMasterBytesAsRemake,
    handleOpen, handleSave, handleGenerate, handleExportHtml, handleSaveProject, handleOpenProject, hasContent,
    handleLlmImport, handleAiApply, handleStartEditing, handleEnterImport, handleCancelInitialize, handleStructureManuscript, handleSlideUpdate,
    handleDiagramChange, handleInsertImage, handleImageRectChange, handleApplySlide, previewSlideEdit, deckHint, diagnostics, contentBox, activeSlideIssues, handleFixIssue, handleVisualizeSlide, currentSlideMd, handleSlideMdChange,
    handleAddSlide, handleDeleteSlide, handleDuplicateSlide, handleMoveSlide,
    currentSlide, currentLayoutName, currentLayout, layoutSuggestions, handleCursorLine, handleSlideClick,
    catalog, setDeck, // exposed for the App-level refine loop (useDeckRefine)
    docs, activeId, createDoc, openDoc, switchDoc, closeDoc, linkHostDoc, // multi-document collection (tabs, P0.2)
    editLockedRef, // App syncs this from collab.status to drive observe-only locking
    collabRef, // App injects the P2.5 collaboration bridge here when connected
  };
}
