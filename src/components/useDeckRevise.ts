/**
 * useDeckRevise — the "整形 (distill)" cluster of deck behaviour, split out of
 * useDeckController to keep that file within the 400-line rule (R1) and to give
 * the harness-directed loop (ROADMAP "①③の交点") its own home as it grows.
 *
 * Owns: the non-destructive review (diagnostics + budget), deterministic manuscript
 * structuring, and the deterministic per-issue fix (visualize → table). AI-backed
 * fixes live in the Edit AI dock (AiPanel) with a before→after diff + 採用/却下 —
 * never applied blind. Every Markdown edit here goes through setMdText so the
 * editor's own history makes it undoable; a silent re-parse refreshes the deck.
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

  // ── Markdown-span primitive (rewrite one slide's source range in mdText) ──
  const replaceSlideSpan = useCallback(
    (slideIndex: number, newMd: string) => {
      const slide = deck?.slides[slideIndex];
      if (!slide?.sourceLineStart || !slide.sourceLineEnd) return; // split slide → no span
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

  // ── Fix ONE diagnostic, mechanically (deterministic lever: visualize → table) ──
  const handleFixIssue = useCallback(
    (issue: DeckIssue) => {
      if (!issue.levers.includes("visualize")) return; // deterministic lever only
      const slide = deck?.slides[issue.slideIndex];
      if (!slide?.sourceLineStart || !slide.sourceLineEnd) return;
      const md = mdText.split("\n").slice(slide.sourceLineStart - 1, slide.sourceLineEnd).join("\n");
      const fixed = visualizeKeyValueMd(md);
      if (fixed) replaceSlideSpan(issue.slideIndex, fixed);
    },
    [deck, mdText, replaceSlideSpan],
  );

  return { diagnostics, contentBox, activeSlideIssues, handleStructureManuscript, handleFixIssue };
}
