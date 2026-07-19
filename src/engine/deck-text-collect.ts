/**
 * deck-text-collect.ts — walk a DeckIR and collect every rendered text string (pure, R2: no
 * DOM/Tauri). Feeds the runtime CJK font-subsetting pipeline (#193 / #115-b): the caller needs
 * the deck's actual used characters to ask harfbuzz for a WOFF2 subset containing only them.
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
