/**
 * parse-notice.ts — the side-channel a parse pass uses to report a fallback that
 * ONLY the parser can see: the raw lines it dropped are gone from SlideIR the
 * moment parsing decides what to keep, so deck-diagnostics (which only sees the
 * parsed DeckIR) can't reconstruct the fact afterward (#148). Mirrors
 * distillDeckReport's `{ deck, newIndices }` side-channel shape — a plain data
 * type, no imports (R2).
 */

/**
 * `table-dropped`: a GFM table was found in a slide's body, but OTHER body content (surrounding
 * prose and/or a 2nd+ table) existed alongside it and was discarded — only the FIRST table's rows
 * survive into SlideIR (md-slide-parser #148). Fires whenever ANY leftover exists.
 *
 * `image-dropped` / `meta-key-dropped`: sub-classifications of a table-dropped leftover — the
 * discarded content happened to be SHAPED like an image line / an unrecognized `Key: Value` line.
 * Outside a table-drop, these same shapes are RECONSTRUCTABLE from the parsed body text (they fall
 * through to a plain paragraph verbatim), so deck-diagnostics detects them there instead (R2) using
 * the SAME IMAGE_MARKDOWN_RE / unrecognizedMetaKey below — only when a table's mutually-exclusive
 * body branch swallows the raw line before it can become a paragraph does the PARSER have to report it.
 */
export type ParseNoticeKind = "table-dropped" | "image-dropped" | "meta-key-dropped";

export interface ParseNotice {
  kind: ParseNoticeKind;
  /** meta-key-dropped only: the unrecognized key (e.g. "Meta"). */
  detail?: string;
}

/** A ParseNotice once its originating block is known to have become slide `slideIndex`. */
export interface SlideParseNotice extends ParseNotice {
  slideIndex: number;
}

/** A line/paragraph shaped like `![alt](src)` — an image line that never became an embedded image
 *  (2nd+ image, or an unsupported src). Shared by md-slide-parser (scanning raw dropped lines) and
 *  deck-diagnostics (scanning surviving body-paragraph text) — same shape, checked in two places
 *  depending on whether the line survived into SlideIR or was swallowed by a table drop. */
export const IMAGE_MARKDOWN_RE = /!\[[^\]]*\]\([^)]+\)/;

/** `Category:` / `Date:` / `Footer:` are the only recognized title-slide meta keys (slide-roles.ts).
 *  Any OTHER `Key: Value`-shaped line — matching the parser's own recognized-field regex shape, minus
 *  the key — is unrecognized. Returns the key, or null if `line` doesn't have this shape at all. */
const RECOGNIZED_META_KEYS = new Set(["category", "date", "footer"]);
export function unrecognizedMetaKey(line: string): string | null {
  const m = /^([A-Za-z]+):\s*(.+)$/.exec(line.trim());
  if (!m || RECOGNIZED_META_KEYS.has(m[1].toLowerCase())) return null;
  return m[1];
}
