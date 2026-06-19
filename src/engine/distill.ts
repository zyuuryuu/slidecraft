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

/**
 * Split a content slide whose single body overflows `box` into multiple slides,
 * repeating the title/meta on each. Returns [slide] unchanged when it fits, or
 * when the slide isn't a plain single-body content slide (diagrams, mermaid, and
 * multi-body/column slides are left to other levers).
 */
export function splitSlideToFit(slide: SlideIR, box: FitBox): SlideIR[] {
  if (slide.diagram || slide.mermaidBlock) return [slide];

  const hasCtrTitle = slide.placeholders.some((p) => p.idx === "0");
  const bodies = slide.placeholders.filter(
    (p) => slideIdxRole(p.idx, hasCtrTitle) === "body",
  );
  if (bodies.length !== 1) return [slide];

  const body = bodies[0];
  const chunks = packParagraphs(body.paragraphs, box);
  if (chunks.length <= 1) return [slide];

  return chunks.map((chunk) => ({
    ...slide,
    // a fresh deck slide per chunk: keep title/subtitle/meta, swap the body text
    placeholders: slide.placeholders.map((p) =>
      p.idx === body.idx ? { ...p, paragraphs: chunk } : p,
    ),
    // these only make sense for the original source span
    sourceLineStart: undefined,
    sourceLineEnd: undefined,
  }));
}

/** The content-body fit box for the loaded template, if it has a content layout. */
export function contentBodyBox(catalog: LayoutCatalog): FitBox | undefined {
  const body = pickLayout(catalog, "content", 1)?.placeholders.find((p) => p.role === "body");
  if (!body || body.charsPerLine <= 0 || body.maxLines <= 0) return undefined;
  return { charsPerLine: body.charsPerLine, maxLines: body.maxLines };
}

/**
 * Distill a whole deck to fit the template: split overflowing content slides.
 * No-op when the template exposes no usable content body. Preview and export both
 * consume the distilled deck, so what you see is what's exported (WYSIWYG).
 */
export function distillDeck(deck: DeckIR, catalog: LayoutCatalog): DeckIR {
  const box = contentBodyBox(catalog);
  if (!box) return deck;
  return { ...deck, slides: deck.slides.flatMap((s) => splitSlideToFit(s, box)) };
}
