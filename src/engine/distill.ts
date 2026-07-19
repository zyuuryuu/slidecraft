/**
 * distill.ts — Fit content to the template WITHOUT shrinking its fonts.
 *
 * The core "last-mile" value: when a slide's body holds more than the template's
 * placeholder can show, we DISTILL it to fit the design. The first, deterministic
 * lever is SPLIT — repack the bullets across as many slides as needed (the design
 * is respected; the deck just gets longer). Rewording/visualizing are later,
 * AI-assisted levers; this module never touches font size.
 *
 * Pure logic (R2): no DOM / Tauri / PptxGenJS. Operates on SlideIR only.
 */

import type { DeckIR, SlideIR, Paragraph } from "./slide-schema";
import type { LayoutCatalog } from "./template-catalog";
import { pickLayout, slideIdxRole } from "./template-catalog";

export interface FitBox {
  charsPerLine: number;
  maxLines: number;
}

/** Lines a paragraph occupies in a box `charsPerLine` wide (≥1). */
export function paragraphLines(p: Paragraph, charsPerLine: number): number {
  const chars = p.segments.reduce((n, s) => n + [...s.text].length, 0);
  if (charsPerLine <= 0) return 1;
  return Math.max(1, Math.ceil(chars / charsPerLine));
}

/**
 * Greedy line-packing: distribute paragraphs into chunks that each fit `maxLines`.
 * Never splits a paragraph (a single bullet stays whole). A lone paragraph taller
 * than the box becomes its own chunk and overflows — that's the reword lever's job,
 * not this one. Returns at least one chunk.
 */
export function packParagraphs(paragraphs: Paragraph[], box: FitBox): Paragraph[][] {
  if (box.maxLines <= 0 || box.charsPerLine <= 0) return [paragraphs];
  const chunks: Paragraph[][] = [];
  let cur: Paragraph[] = [];
  let used = 0;
  for (const p of paragraphs) {
    const need = paragraphLines(p, box.charsPerLine);
    if (cur.length > 0 && used + need > box.maxLines) {
      chunks.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(p);
    used += need;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks.length > 0 ? chunks : [paragraphs];
}

/** The slide's single text body among its placeholders — the shape splitSlideToFit acts on
 *  (diagrams/mermaid/multi-body slides have none). Exported so a dry-run read (get_slide's
 *  predictedSplit/capacity, #149) can measure the SAME body splitSlideToFit would split,
 *  without re-deriving which placeholder that is. */
export function soleBodyPlaceholder(slide: SlideIR) {
  if (slide.diagram || slide.mermaidBlock) return undefined;
  const hasCtrTitle = slide.placeholders.some((p) => p.idx === "0");
  const bodies = slide.placeholders.filter((p) => slideIdxRole(p.idx, hasCtrTitle) === "body");
  return bodies.length === 1 ? bodies[0] : undefined;
}

/**
 * Split a content slide whose single body overflows `box` into multiple slides,
 * repeating the title/meta on each. Returns [slide] unchanged when it fits, or
 * when the slide isn't a plain single-body content slide (diagrams, mermaid, and
 * multi-body/column slides are left to other levers).
 */
export function splitSlideToFit(slide: SlideIR, box: FitBox): SlideIR[] {
  const body = soleBodyPlaceholder(slide);
  if (!body) return [slide];

  const hasCtrTitle = slide.placeholders.some((p) => p.idx === "0");
  const chunks = packParagraphs(body.paragraphs, box);
  if (chunks.length <= 1) return [slide];

  return chunks.map((chunk, ci) => ({
    ...slide,
    // Speaker notes stay on the FIRST chunk only (ADR-0032 D1) — the spread above would
    // otherwise duplicate them onto every continuation slide.
    ...(ci > 0 ? { notes: undefined } : {}),
    // a fresh deck slide per chunk: keep title/subtitle/meta, swap the body text.
    placeholders: slide.placeholders.map((p) => {
      if (p.idx === body.idx) return { ...p, paragraphs: chunk };
      // Continuation slides get a provisional "（続き）" on the title — a placeholder
      // the AI re-title lever (or upstream) is meant to replace with a fitting title.
      if (ci > 0 && slideIdxRole(p.idx, hasCtrTitle) === "title") {
        return { ...p, paragraphs: appendTitleMarker(p.paragraphs, "（続き）") };
      }
      return p;
    }),
    // these only make sense for the original source span
    sourceLineStart: undefined,
    sourceLineEnd: undefined,
  }));
}

/** Dry-run of splitSlideToFit (#149): how many slides `slide` WOULD become in `box`, and how
 *  many paragraphs land in each, WITHOUT mutating anything. Calls splitSlideToFit itself — the
 *  exact function split_overflowing_slides runs — so the prediction can never drift from the
 *  actual split (R8). undefined when the slide doesn't split (fits, or isn't a plain
 *  single-body content slide). */
export function predictSplit(slide: SlideIR, box: FitBox): { chunks: number; boundaries: number[] } | undefined {
  const parts = splitSlideToFit(slide, box);
  if (parts.length <= 1) return undefined;
  const bodyIdx = soleBodyPlaceholder(slide)?.idx;
  const boundaries = parts.map((p) => p.placeholders.find((ph) => ph.idx === bodyIdx)?.paragraphs.length ?? 0);
  return { chunks: parts.length, boundaries };
}

/** Append a marker segment to the title's last paragraph (provisional split title). */
function appendTitleMarker(paragraphs: Paragraph[], marker: string): Paragraph[] {
  if (paragraphs.length === 0) return [{ segments: [{ text: marker }] }];
  const last = paragraphs.length - 1;
  return paragraphs.map((p, i) =>
    i === last ? { ...p, segments: [...p.segments, { text: ` ${marker}` }] } : p,
  );
}

/** The content-body fit box for the loaded template, if it has a content layout. */
export function contentBodyBox(catalog: LayoutCatalog): FitBox | undefined {
  const box = (p?: { charsPerLine: number; maxLines: number }) =>
    p && p.charsPerLine > 0 && p.maxLines > 0 ? { charsPerLine: p.charsPerLine, maxLines: p.maxLines } : undefined;
  const best = box(pickLayout(catalog, "content", 1)?.placeholders.find((p) => p.role === "body"));
  if (best) return best;
  // Fallback: ANY content layout with a usable text body (robust on alien templates
  // where even the best-scored layout might still have a degenerate body).
  for (const e of catalog.filter((e) => e.role === "content")) {
    const b = box(e.placeholders.find((p) => p.role === "body"));
    if (b) return b;
  }
  return undefined;
}

/**
 * Distill a whole deck to fit the template: split overflowing content slides.
 * No-op when the template exposes no usable content body. Preview and export both
 * consume the distilled deck, so what you see is what's exported (WYSIWYG).
 */
export function distillDeck(deck: DeckIR, catalog: LayoutCatalog): DeckIR {
  return distillDeckReport(deck, catalog).deck;
}

/** As distillDeck, but ALSO report the NEW slide indices produced by splitting — a source slide that
 *  splits into N parts inserts continuation slides mid-deck, shifting all downstream indices, so an
 *  index-addressed follow-up (get_slide_markdown, set_slide_markdown…) would otherwise target a stale
 *  slide. `newIndices` are those post-split positions (Theme 3 S6: split's changedSlides). */
export function distillDeckReport(deck: DeckIR, catalog: LayoutCatalog): { deck: DeckIR; newIndices: number[] } {
  const box = contentBodyBox(catalog);
  if (!box) return { deck, newIndices: [] };
  const slides: SlideIR[] = [];
  const newIndices: number[] = [];
  for (const s of deck.slides) {
    const parts = splitSlideToFit(s, box);
    if (parts.length > 1) for (let k = 0; k < parts.length; k++) newIndices.push(slides.length + k);
    slides.push(...parts);
  }
  return { deck: { ...deck, slides }, newIndices };
}
