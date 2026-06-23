/**
 * useDeckRevise — the "整形 (distill)" cluster of deck behaviour, split out of
 * useDeckController to keep that file within the 400-line rule (R1) and to give
 * the harness-directed loop (ROADMAP "①③の交点") its own home as it grows.
 *
 * Owns: the non-destructive review (diagnostics + budget), deterministic manuscript
 * structuring, and per-issue fixes — mechanical (visualize → table) AND AI-backed
 * (condense/title via the slide-fix contract). Every fix rewrites just one slide's
 * Markdown span through setMdText, so the editor's own history makes it undoable
 * (Import-mode undo); a silent re-parse then refreshes the deck.
 */

import { useCallback, useMemo, useState } from "react";
import { contentBodyBox } from "../engine/distill";
import { diagnoseDeck, type DeckIssue } from "../engine/deck-diagnostics";
import { visualizeKeyValueMd } from "../engine/slide-rewrite";
import { structureManuscript } from "../engine/manuscript";
import { buildSlideFix, slideFixRequest } from "../engine/slide-fix";
import type { DeckIR } from "../engine/slide-schema";
import type { LayoutCatalog } from "../engine/template-catalog";
import type { HistoryMode } from "./useHistoryState";
import { useAiGeneration } from "./useAiGeneration";

interface ReviseDeps {
  mdText: string;
  setMdText: (s: string) => void;
  parseMdText: (text: string, mode?: HistoryMode | "reset") => void;
  deck: DeckIR | null;
  catalog: LayoutCatalog | undefined;
  activeSlide: number;
}

export function useDeckRevise({ mdText, setMdText, parseMdText, deck, catalog, activeSlide }: ReviseDeps) {
  const ai = useAiGeneration();
  const [aiFixingKey, setAiFixingKey] = useState<string | null>(null);
  const [aiFixError, setAiFixError] = useState<string | null>(null);

  // Non-destructive deck review (overflow / long bullets / key-value / missing title).
  const diagnostics = useMemo(() => (deck && catalog ? diagnoseDeck(deck, catalog) : []), [deck, catalog]);
  // The template's content-body capacity → the budget half of the slide-fix contract.
  const contentBox = useMemo(() => (catalog ? contentBodyBox(catalog) : undefined), [catalog]);
  // Issues for the slide currently being edited → "AIで整える" in the Edit AI dock.
  const activeSlideIssues = useMemo(
    () => diagnostics.filter((d) => d.slideIndex === activeSlide),
    [diagnostics, activeSlide],
  );

  // ── Markdown-span primitives (one slide's source range in mdText) ──
  const slideSourceMd = useCallback(
    (slideIndex: number): string | null => {
      const slide = deck?.slides[slideIndex];
      if (!slide?.sourceLineStart || !slide.sourceLineEnd) return null; // split slide → no span
      return mdText.split("\n").slice(slide.sourceLineStart - 1, slide.sourceLineEnd).join("\n");
    },
    [deck, mdText],
  );

  const replaceSlideSpan = useCallback(
    (slideIndex: number, newMd: string) => {
      const slide = deck?.slides[slideIndex];
      if (!slide?.sourceLineStart || !slide.sourceLineEnd) return;
      const lines = mdText.split("\n");
      const start = slide.sourceLineStart - 1;
      const end = slide.sourceLineEnd - 1;
      const next = [...lines.slice(0, start), ...newMd.split("\n"), ...lines.slice(end + 1)].join("\n");
      setMdText(next); // editor records this as one undoable step (Import undo)
      parseMdText(next, "silent");
    },
    [deck, mdText, setMdText, parseMdText],
  );

  // ── Manuscript → slides (deterministic structuring of a raw prose manuscript) ──
  const handleStructureManuscript = useCallback(() => {
    const structured = structureManuscript(mdText);
    if (structured && structured !== mdText.trim()) {
      setMdText(structured); // editor records this as one undoable step (Import undo)
      parseMdText(structured, "silent");
    }
  }, [mdText, setMdText, parseMdText]);

  // ── Fix ONE diagnostic, mechanically (per-issue granularity) ──
  // Deterministic lever (visualize): rewrite the slide's key-value bullets to a table.
  const handleFixIssue = useCallback(
    (issue: DeckIssue) => {
      if (!issue.levers.includes("visualize")) return; // deterministic lever only
      const md = slideSourceMd(issue.slideIndex);
      if (!md) return;
      const fixed = visualizeKeyValueMd(md);
      if (fixed) replaceSlideSpan(issue.slideIndex, fixed);
    },
    [slideSourceMd, replaceSlideSpan],
  );

  // ── Fix ONE diagnostic with AI (condense/title) — the slide-fix contract, scoped
  // to a single issue. `key` identifies the chip so the UI can show a per-chip spinner.
  const handleAiFixIssue = useCallback(
    async (issue: DeckIssue, key: string) => {
      if (aiFixingKey) return; // one AI fix at a time
      const md = slideSourceMd(issue.slideIndex);
      if (!md) return;
      setAiFixingKey(key);
      setAiFixError(null);
      try {
        const result = await ai.generateOnce(slideFixRequest(buildSlideFix(md, [issue], contentBox)), "slide");
        if (result?.trim()) replaceSlideSpan(issue.slideIndex, result);
      } catch (e) {
        setAiFixError(e instanceof Error ? e.message : String(e));
      } finally {
        setAiFixingKey(null);
      }
    },
    [aiFixingKey, slideSourceMd, replaceSlideSpan, contentBox, ai],
  );

  return {
    diagnostics, contentBox, activeSlideIssues,
    handleStructureManuscript, handleFixIssue,
    handleAiFixIssue, aiFixingKey, aiFixError, aiConnected: ai.connection.ok,
  };
}
