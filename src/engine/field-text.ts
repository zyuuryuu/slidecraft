/**
 * field-text.ts — a placeholder's paragraphs ⇄ the GUI field editor's textarea text (SlideEditor).
 *
 * Pure logic (R2), moved out of SlideEditor.tsx (#394) so it is testable and the component file only
 * exports components. Reads/writes the same line syntax as the Markdown parser/serializer through the
 * shared helpers — md-inline (#393), paragraph-nesting (#103), list-markers (#394) — rather than its
 * own copy (R8). Unlike the serializer it does not escape a comment-only line (#165): the textarea is
 * one field's text, never re-parsed as a whole slide.
 */
import type { Paragraph } from "./slide-schema";
import { levelFromIndent, measureIndent } from "./paragraph-nesting";
import { matchListItem, orderedNumbers, listItemLine } from "./list-markers";
import { parseInline, serializeInline } from "./md-inline";

// ── Convert paragraphs to plain text for textarea ──

export function paragraphsToText(paragraphs: Paragraph[]): string {
  const numbers = orderedNumbers(paragraphs);
  return paragraphs
    .map((p, i) => {
      const text = serializeInline(p.segments);
      if (p.heading) return `### ${text}`;
      // Preserve nesting (#103) and numbering (#394) so opening/saving an unrelated field never
      // flattens an already-nested or numbered item — the field editor doesn't add Tab/Shift-Tab
      // controls (out of scope, tracked separately), but a plain re-save must still be a no-op.
      // The line writer is the serializer's own (list-markers, R8).
      return p.bullet ? listItemLine(p, numbers[i], text) : text;
    })
    .join("\n");
}

// ── Convert plain text back to paragraphs ──

export function textToParagraphs(text: string): Paragraph[] {
  return text.split("\n").map((line) => {
    const headingMatch = line.match(/^###\s+(.*)/);
    const bulletMatch = headingMatch ? null : matchListItem(line.replace(/^[ \t]*/, "")); // `-`/`*`/`1.` (#394)
    const content = headingMatch ? headingMatch[1] : bulletMatch ? bulletMatch.content : line;
    const level = bulletMatch ? levelFromIndent(measureIndent(line)) : 0;

    // Inline formatting via the engine's single inline parser (R8 — md-inline.ts, #393).
    const segments = parseInline(content);

    return {
      segments,
      ...(headingMatch
        ? { heading: true }
        : bulletMatch
          ? { bullet: true, ...(level > 0 ? { level } : {}), ...(bulletMatch.ordered ? { ordered: true } : {}) }
          : {}),
    };
  });
}
