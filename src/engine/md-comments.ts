/**
 * md-comments.ts — Markdown HTML-comment handling shared by the slide parser and the serializer.
 * Pure (R2). The parser drops comment-only content (#147 one-line, #588 multi-line); the serializer
 * escapes a GUI paragraph that would collide with that drop (#165) via the SAME predicates here, so
 * "what the parser drops" and "what the serializer escapes" have one source (R8).
 */

/** A line that is NOTHING but comments — one or more complete `<!-- … -->` units
 *  (optionally whitespace-separated), plus the WHATWG abrupt-close forms `<!-->` /
 *  `<!--->`. All render as nothing in any HTML view. A line with visible text outside
 *  the markers never matches (inline-comment strip = #147 第2弾スコープ). */
export const COMMENT_ONLY_RE = /^(?:(?:<!--(?:(?!-->).)*-->|<!--->|<!-->)\s*)+$/;

/** Directive comments that carry meaning — the layout pin, the group separators, the
 *  speaker-note marker (ADR-0032 D1), and the section/toc declarations (ADR-0032 D2).
 *  A payload form (`<!-- note: … -->` etc.) is NOT a directive and stays in the #147
 *  drop class — only the bare markers survive. */
export const DIRECTIVE_COMMENT_RE = /^<!--\s*(?:slide:|(?:col|kpi|step|card|compare|before|after|note|section|toc|step\s*\*)\s*-->$)/; // `step *` = #401

/** #588: a line that is nothing but (optional complete comments, then) an UNCLOSED `<!--` — the
 *  first line of a multi-line comment. `<!-->` / `<!--->` are abrupt closes, not openers. */
const COMMENT_OPEN_RE = /^(?:(?:<!--(?:(?!-->).)*-->|<!--->|<!-->)\s*)*<!--(?!-?>)(?:(?!-->).)*$/;
/** A multi-line `<!-- slide:` is a broken layout pin: keep it visible rather than drop it silently. */
const SLIDE_PIN_OPEN_RE = /^<!--\s*slide:/;

/** True iff the trimmed line opens a multi-line comment the parser would drop once it is closed. */
export function opensComment(trimmed: string): boolean {
  return COMMENT_OPEN_RE.test(trimmed) && !SLIDE_PIN_OPEN_RE.test(trimmed);
}

/** Index of the line closing a comment opened at `open`, if that closer has nothing visible after
 *  its first `-->` (only whitespace or further complete comments). Otherwise −1: unclosed, or an
 *  inline comment with trailing text (#147 第2弾) — those lines stay text, as before (never-silent). */
function wholeCommentEnd(lines: string[], open: number): number {
  for (let j = open + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    const at = t.indexOf("-->");
    if (at < 0) continue;
    const rest = t.slice(at + 3).trim();
    return rest === "" || COMMENT_ONLY_RE.test(rest) ? j : -1;
  }
  return -1;
}

/**
 * #147: Drop non-directive comment-only lines (review notes / TODO markers / source IDs
 * an upstream agent or human left in the Markdown) so they never render onto a slide.
 * #588: a multi-line comment (opener line … first `-->` line) that is wholly comment drops as one unit;
 * ``` inside it is comment content. Unclosed / trailing-text units fall through line by line unchanged.
 * A dropped comment also swallows the blank lines directly ABOVE it — the comment
 * "paragraph" disappears whole (`A\n\n<!-- note -->\nB` glues to `A\nB`), while a blank
 * AFTER it still separates content as authored. Fence interiors pass through verbatim
 * (a ``` block keeps comment-looking strings), and directive comments are untouched.
 * Dropped comments do NOT round-trip: the serializer never sees them (spec'd in #147).
 */
export function stripCommentOnlyLines(lines: string[]): string[] {
  const out: string[] = [];
  const pendingBlanks: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith("```")) {
      inFence = !inFence;
      out.push(...pendingBlanks.splice(0), line);
    } else if (inFence) {
      out.push(line);
    } else if (t === "") {
      pendingBlanks.push(line);
    } else if (COMMENT_ONLY_RE.test(t) && !DIRECTIVE_COMMENT_RE.test(t)) {
      pendingBlanks.length = 0; // the comment paragraph swallows its leading blanks
    } else {
      const end = opensComment(t) ? wholeCommentEnd(lines, i) : -1;
      if (end >= 0) {
        pendingBlanks.length = 0;
        i = end; // skip opener … closer as one comment unit
      } else {
        out.push(...pendingBlanks.splice(0), line);
      }
    }
  }
  out.push(...pendingBlanks); // trailing blanks (trimBodyLines handles them downstream)
  return out;
}
