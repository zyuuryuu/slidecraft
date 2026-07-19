/**
 * deck-text-collect.ts — walk a DeckIR and collect every rendered text string (pure, R2: no
 * DOM/Tauri). Feeds the runtime CJK font-subsetting pipeline (#193 / #115-b): the caller needs
 * the deck's actual used characters to ask harfbuzz for a font subset containing only them.
 *
 * Scope: placeholder paragraphs, table cells, code blocks, image alt text, and speaker notes —
 * everything SlideCard renders as literal text. Diagram/mermaid blocks carry their own YAML/DSL
 * source (not directly-displayed text in the same sense) and are out of scope here; any CJK glyph
 * they render still falls back to the font-stack.ts (#192) chain when it isn't in a subset.
 */
import type { DeckIR, Paragraph } from "./slide-schema";

function paragraphText(p: Paragraph): string {
  return p.segments.map((s) => s.text).join("");
}

/** Concatenate every literal text string in the deck, in slide order. Not deduped — the caller
 *  (the WASM subsetter) collects the unique codepoint set itself. */
export function collectDeckText(deck: DeckIR): string {
  const parts: string[] = [];
  for (const slide of deck.slides) {
    for (const ph of slide.placeholders) {
      for (const p of ph.paragraphs) parts.push(paragraphText(p));
    }
    if (slide.table) {
      for (const row of slide.table.rows) parts.push(row.join(""));
    }
    if (slide.code) parts.push(slide.code.content);
    if (slide.image?.alt) parts.push(slide.image.alt);
    if (slide.notes) {
      for (const p of slide.notes) parts.push(paragraphText(p));
    }
  }
  return parts.filter((s) => s.length > 0).join("\n");
}

/** Whether any RENDERED text in the deck is bold (#194): an inline `bold` segment, a card/step group
 *  heading paragraph (SlideCard forces fontWeight:bold on those), or a table with its header row
 *  (SlideCard renders row 0 at fontWeight:700 when `header` is set). Drives which font weights the
 *  HTML-export subset-embedding pipeline needs to fetch — a deck with no bold usage only needs the
 *  smaller regular-weight subset. */
export function deckUsesBold(deck: DeckIR): boolean {
  const paragraphsBold = (paragraphs: Paragraph[]) =>
    paragraphs.some((p) => p.heading || p.segments.some((s) => s.bold));
  for (const slide of deck.slides) {
    if (slide.table?.header) return true;
    for (const ph of slide.placeholders) if (paragraphsBold(ph.paragraphs)) return true;
    if (slide.notes && paragraphsBold(slide.notes)) return true;
  }
  return false;
}

// Hiragana/Katakana (U+3040-30FF), CJK Unified + Ext-A (U+3400-9FFF), CJK Compatibility Ideographs
// (U+F900-FAFF), halfwidth Katakana (U+FF66-FF9F) — enough to detect "this deck's text needs a
// CJK-capable font" without needing a full Unicode script table.
const CJK_RANGE = /[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/;

/** Whether `text` (as returned by collectDeckText) contains any CJK glyph. A deck with none of these
 *  never needs the subset-embedding pipeline at all (#194 do-no-harm: zero size cost for non-CJK
 *  decks — the existing Latin font stack already renders them correctly). */
export function deckHasCjkText(text: string): boolean {
  return CJK_RANGE.test(text);
}
