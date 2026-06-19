/**
 * md-to-ooxml.ts — Convert SlideIR paragraphs to OOXML <a:p> elements.
 *
 * Handles inline formatting (bold, italic) and bullet lists.
 */

import type { Paragraph, InlineSegment } from "./slide-schema";

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function segmentToRun(seg: InlineSegment): string {
  const attrs: string[] = [];
  if (seg.bold) attrs.push('b="1"');
  if (seg.italic) attrs.push('i="1"');

  const rPr =
    attrs.length > 0 ? `<a:rPr ${attrs.join(" ")}/>` : "";

  return `<a:r>${rPr}<a:t>${escXml(seg.text)}</a:t></a:r>`;
}

export function paragraphToOoxml(para: Paragraph): string {
  const runs = para.segments.map(segmentToRun).join("");
  // Follow the slide master's bullet style — never force a glyph. Bullet lines
  // inherit the placeholder/master list style; non-bullet lines suppress it.
  const pPr = para.bullet ? "" : "<a:pPr><a:buNone/></a:pPr>";
  return `<a:p>${pPr}${runs}</a:p>`;
}

export function paragraphsToOoxml(paragraphs: Paragraph[]): string {
  return paragraphs.map(paragraphToOoxml).join("");
}
