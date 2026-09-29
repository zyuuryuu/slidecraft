/**
 * md-to-ooxml.ts — Convert SlideIR paragraphs to OOXML <a:p> elements.
 *
 * Handles inline formatting (bold, italic, strike, hyperlink — #393) and bullet lists.
 */

import type { Paragraph, InlineSegment } from "./slide-schema";
import { isSafeHref } from "./md-inline";

/** XML text/attribute escape (& < > ") — shared by every OOXML writer that inlines user text. */
export function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** href → the relationship id of an External hyperlink rel in the part being written
 *  (hyperlink-rels.ts). Absent → a linked segment renders as its plain label. */
export type LinkResolver = (href: string) => string;

export interface RunStyle {
  /** Leading rPr attributes (e.g. a table cell's `lang`/`sz`), emitted before b/i/strike. */
  baseAttrs?: string[];
  /** Force bold regardless of the segment (a table header row). */
  bold?: boolean;
  /** rPr fill child (e.g. `<a:solidFill>…`) — precedes hlinkClick per the CT_TextCharacterProperties order. */
  fillXml?: string;
  link?: LinkResolver;
}

/** One <a:r> for a segment — the ONE run writer for body/notes paragraphs and table cells. */
export function segmentToRun(seg: InlineSegment, style: RunStyle = {}): string {
  const attrs = [...(style.baseAttrs ?? [])];
  if (seg.bold || style.bold) attrs.push('b="1"');
  if (seg.italic) attrs.push('i="1"');
  if (seg.strike) attrs.push('strike="sngStrike"');
  const rId = seg.href && style.link && isSafeHref(seg.href) ? style.link(seg.href) : undefined;
  const children = (style.fillXml ?? "") + (rId ? `<a:hlinkClick r:id="${rId}"/>` : "");
  const open = `<a:rPr${attrs.map((a) => ` ${a}`).join("")}`;
  const rPr = children ? `${open}>${children}</a:rPr>` : attrs.length > 0 ? `${open}/>` : "";

  return `<a:r>${rPr}<a:t>${escXml(seg.text)}</a:t></a:r>`;
}

export function paragraphToOoxml(para: Paragraph, link?: LinkResolver): string {
  const runs = para.segments.map((seg) => segmentToRun(seg, { link })).join("");
  // Follow the slide master's bullet style — never force a glyph. Bullet lines
  // inherit the placeholder/master list style; non-bullet lines suppress it.
  // Nesting (#103): lvl="1..3" selects the master's lvl2pPr..lvl4pPr list style — PowerPoint
  // resolves the glyph/font/indent from there, so nothing else is pinned here (R7/master-font-inherit).
  // level 0 (the default) omits the attribute entirely — byte-identical with pre-#103 output.
  const pPr = para.bullet
    ? (para.level ? `<a:pPr lvl="${para.level}"/>` : "")
    : "<a:pPr><a:buNone/></a:pPr>";
  return `<a:p>${pPr}${runs}</a:p>`;
}

export function paragraphsToOoxml(paragraphs: Paragraph[], link?: LinkResolver): string {
  return paragraphs.map((p) => paragraphToOoxml(p, link)).join("");
}
