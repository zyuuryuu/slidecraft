/**
 * figure-placement.ts — #392 段 2: the ONE resolver of "which body ordinal does each visual of this slide
 * go to" (R8). slideRoleRegions (layout choice), visual-placement (ordinal → placeholder), the PPTX export,
 * the preview / HTML and deck-diagnostics all read it, so the layout is chosen for exactly the regions the
 * renderers then fill.
 *
 * The SlideIR is NOT rewritten: `placeholderIdx` stays what the parser / editor stored (so md and .scft
 * are unchanged); this is a read-time placement.
 *
 * - ONE visual: its own ordinal, as before. A diagram / mermaid at ordinal 1 is SOLO (it fills the slide,
 *   it needs no region) — the historical rule, kept byte for byte.
 * - TWO or more: in source order (slideFigures), each keeps its stored ordinal unless an earlier visual
 *   already took it; then it moves to the next ordinal that neither another visual nor body text uses.
 *   That is what separates 表＋図 (both stored at "1" — or both at "2" beside body text, #390) into two
 *   regions instead of painting one over the other (#434). Nothing is solo: a full-slide figure would
 *   cover the others.
 *
 * A behind image is a backmost layer, not a body visual (slideFigures leaves it out). Pure (R2).
 */
import type { SlideIR, FigureBlock } from "./slide-schema";
import { slideFigures } from "./slide-figures";

export interface PlacedFigure {
  figure: FigureBlock;
  /** The body ordinal ("1" = 1st body region) it is placed at. */
  ordinal: string;
  /** Fills the whole slide instead of a region (a lone diagram / mermaid at ordinal 1). */
  solo: boolean;
  /** The first visual of its kind = the singular field editors write (set_slide_diagram, the image drag). */
  primary: boolean;
}

const ordinalOf = (idx: string) => parseInt(idx) || 1;

export function placedFigures(slide: SlideIR): PlacedFigure[] {
  const figs = slideFigures(slide);
  if (figs.length === 1) {
    const f = figs[0];
    return [{ figure: f, ordinal: f.placeholderIdx, solo: (f.kind === "diagram" || f.kind === "mermaid") && ordinalOf(f.placeholderIdx) === 1, primary: true }];
  }
  const text = new Set(slide.placeholders.filter((p) => /^[1-9]$/.test(p.idx)).map((p) => Number(p.idx)));
  const used = new Set<number>();
  const kinds = new Set<string>();
  return figs.map((f) => {
    let n = ordinalOf(f.placeholderIdx);
    if (used.has(n)) {
      do n++; while (used.has(n) || text.has(n));
    }
    used.add(n);
    const primary = !kinds.has(f.kind);
    kinds.add(f.kind);
    // An unmoved visual keeps its stored string (nthBody reads both the same way).
    return { figure: f, ordinal: n === ordinalOf(f.placeholderIdx) ? f.placeholderIdx : String(n), solo: false, primary };
  });
}
