/**
 * deck-structure.ts — pure deck-level slide STRUCTURE operations (insert / delete / duplicate / move).
 *
 * THE single source of truth shared by the MCP structure tools (session-wrapped) and the GUI slide
 * list, so add / delete / duplicate can never diverge. Every op returns a NEW deck with the SURVIVING
 * slides byte-identical (same refs → their figures / layouts are preserved, no whole-deck reparse);
 * duplicate deep-clones so the copy's diagram / table / code survive byte-identical too. A deck needs
 * ≥1 slide, so deleting the last one is rejected. Pure logic (R2): no DOM / Tauri.
 */
import type { DeckIR, SlideIR } from "./slide-schema";

/** A fresh, empty content slide (auto layout) — the GUI's "＋ 追加" default; the user fills it in. */
export function blankSlide(): SlideIR {
  return { layout: "auto", placeholders: [] };
}

/** Whether a slide already carries content worth preserving (any visible placeholder text OR a figure).
 *  Drives the image-insert default: a slide with content gets the image as a BACKMOST layer (最背面, so
 *  nothing is destroyed); an empty slide gets it as a body figure. Pure (R2). */
export function slideHasContent(slide: SlideIR): boolean {
  const hasText = slide.placeholders.some((p) => p.paragraphs.some((par) => par.segments.some((s) => s.text.trim() !== "")));
  return hasText || !!(slide.diagram || slide.mermaidBlock || slide.table || slide.code);
}

/** Insert `slide` before/after `index`; the position is clamped to a valid slot. Returns the new deck
 *  and the index the slide landed at (so the caller can focus it). */
export function insertSlideAt(deck: DeckIR, index: number, slide: SlideIR, position: "before" | "after" = "after"): { deck: DeckIR; at: number } {
  const at = Math.max(0, Math.min(position === "after" ? index + 1 : index, deck.slides.length));
  const slides = [...deck.slides];
  slides.splice(at, 0, slide);
  return { deck: { ...deck, slides }, at };
}

/** Delete the slide at `index`. Returns null (rejected) when it is the LAST slide (a deck needs ≥1) or
 *  the index is out of range — the caller surfaces that as a never-silent notice. */
export function deleteSlideAt(deck: DeckIR, index: number): DeckIR | null {
  if (deck.slides.length <= 1 || index < 0 || index >= deck.slides.length) return null;
  const slides = [...deck.slides];
  slides.splice(index, 1);
  return { ...deck, slides };
}

/** Duplicate the slide at `index` via a deep clone (so its figure / table / code copy byte-identical —
 *  Markdown is not a lossless carrier). The copy lands adjacent (after by default). */
export function duplicateSlideAt(deck: DeckIR, index: number, position: "before" | "after" = "after"): { deck: DeckIR; newIndex: number } {
  if (index < 0 || index >= deck.slides.length) return { deck, newIndex: index };
  const clone = structuredClone(deck.slides[index]);
  const at = position === "after" ? index + 1 : index;
  const slides = [...deck.slides];
  slides.splice(at, 0, clone);
  return { deck: { ...deck, slides }, newIndex: at };
}

/** Move a slide from `from` to `to` (pure permutation — content / figures / layouts untouched). Returns
 *  the same deck on a no-op (from===to) or an out-of-range index. */
export function moveSlideTo(deck: DeckIR, from: number, to: number): DeckIR {
  const n = deck.slides.length;
  if (from === to || from < 0 || from >= n || to < 0 || to >= n) return deck;
  const slides = [...deck.slides];
  const [moved] = slides.splice(from, 1);
  slides.splice(to, 0, moved);
  return { ...deck, slides };
}
