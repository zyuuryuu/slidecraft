/**
 * useDeckRevise — the "整形 (distill)" cluster of deck behaviour, split out of
 * useDeckController to keep that file within the 400-line rule (R1) and to give
 * the harness-directed loop (ROADMAP "①③の交点") its own home as it grows.
 *
 * Owns: the non-destructive review (diagnostics + budget), deterministic manuscript
 * structuring, and per-issue mechanical fixes. AI-backed fixes (condense/title) will
 * land here too. All Markdown edits go through setMdText so the editor's own history
 * makes them undoable (Import-mode undo), then a silent re-parse refreshes the deck.
 */

import { useCallback, useMemo } from "react";
import { contentBodyBox } from "../engine/distill";
import { diagnoseDeck, type DeckIssue } from "../engine/deck-diagnostics";
import { visualizeKeyValueMd } from "../engine/slide-rewrite";
import { structureManuscript } from "../engine/manuscript";
import type { DeckIR } from "../engine/slide-schema";
import type { LayoutCatalog } from "../engine/template-catalog";
import type { HistoryMode } from "./useHistoryState";

interface ReviseDeps {
  mdText: string;
  setMdText: (s: string) => void;
  parseMdText: (text: string, mode?: HistoryMode | "reset") => void;
  deck: DeckIR | null;
  catalog: LayoutCatalog | undefined;
  activeSlide: number;
}

export function useDeckRevise({ mdText, setMdText, parseMdText, deck, catalog, activeSlide }: ReviseDeps) {
  // Non-destructive deck review (overflow / long bullets / key-value / missing title).
  const diagnostics = useMemo(() => (deck && catalog ? diagnoseDeck(deck, catalog) : []), [deck, catalog]);
  // The template's content-body capacity → the budget half of the slide-fix contract.
  const contentBox = useMemo(() => (catalog ? contentBodyBox(catalog) : undefined), [catalog]);
  // Issues for the slide currently being edited → "AIで整える" in the Edit AI dock.
  const activeSlideIssues = useMemo(
    () => diagnostics.filter((d) => d.slideIndex === activeSlide),
    [diagnostics, activeSlide],
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
  // Rewrites just that slide's Markdown span; deterministic levers only (visualize).
  // Condense/title need the AI contract (handled in the Edit AI dock). Undoable.
  const handleFixIssue = useCallback(
    (issue: DeckIssue) => {
      const slide = deck?.slides[issue.slideIndex];
      if (!slide?.sourceLineStart || !slide.sourceLineEnd) return; // split slide → no span
      if (!issue.levers.includes("visualize")) return; // only the deterministic lever here
      const lines = mdText.split("\n");
      const start = slide.sourceLineStart - 1;
      const end = slide.sourceLineEnd - 1;
      const fixed = visualizeKeyValueMd(lines.slice(start, end + 1).join("\n"));
      if (!fixed) return;
      const next = [...lines.slice(0, start), ...fixed.split("\n"), ...lines.slice(end + 1)].join("\n");
      setMdText(next); // editor records this as one undoable step (Import undo)
      parseMdText(next, "silent");
    },
    [deck, mdText, setMdText, parseMdText],
  );

  return { diagnostics, contentBox, activeSlideIssues, handleStructureManuscript, handleFixIssue };
}
