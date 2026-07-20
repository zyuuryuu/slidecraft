/**
 * bullet-indent-shift.ts — Tab/Shift-Tab indent shift for a bullet line in raw editor text (#201).
 *
 * Pure logic (R2): given the full textarea text and a cursor/selection, if the CURRENT line is a
 * bullet (`- ` / `* `, optionally indented), computes the line with its nesting level bumped up
 * (Tab) or down (Shift-Tab) by one, clamped to [0, MAX_NEST_LEVEL] — never grows past level 3,
 * never goes negative (#103 clamp semantics, same as levelFromIndent). Reuses the #103 helpers
 * (levelFromIndent / indentForLevel / measureIndent) rather than re-deriving indent↔level mapping
 * (R8 — one path for "what level does this indent mean").
 *
 * Returns null when the cursor's line isn't a bullet, so the caller can fall back to the browser's
 * default Tab behavior (focus move) instead of hijacking every keypress.
 */
import { MAX_NEST_LEVEL, indentForLevel, levelFromIndent, measureIndent } from "./paragraph-nesting";

const BULLET_LINE_RE = /^([ \t]*)([-*])(\s+)(.*)$/;

export interface BulletIndentShiftResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Shifts the bullet line under `selectionStart` one nesting level (outdent=true → Shift-Tab).
 *  `selectionEnd` lets a same-line selection survive the shift; a selection spanning past the
 *  line's end collapses to the (shifted) start, since only the cursor's own line is touched. */
export function shiftBulletIndent(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  outdent: boolean,
): BulletIndentShiftResult | null {
  const lineStart = text.lastIndexOf("\n", selectionStart - 1) + 1;
  const nextNewline = text.indexOf("\n", selectionStart);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;
  const line = text.slice(lineStart, lineEnd);

  const match = line.match(BULLET_LINE_RE);
  if (!match) return null;
  const [, indent, marker, ws, content] = match;

  const level = levelFromIndent(measureIndent(line));
  const newLevel = outdent ? Math.max(level - 1, 0) : Math.min(level + 1, MAX_NEST_LEVEL);
  const newIndent = indentForLevel(newLevel);
  const newLine = `${newIndent}${marker} ${content}`;

  const oldPrefixLen = indent.length + marker.length + ws.length;
  const newPrefixLen = newIndent.length + marker.length + 1;
  const shiftPos = (pos: number) => {
    const offset = Math.min(pos - lineStart, line.length);
    return offset <= oldPrefixLen ? newPrefixLen : newPrefixLen + (offset - oldPrefixLen);
  };

  const newSelectionStart = lineStart + shiftPos(selectionStart);
  const newSelectionEnd = selectionEnd <= lineEnd ? lineStart + shiftPos(selectionEnd) : newSelectionStart;

  return {
    text: text.slice(0, lineStart) + newLine + text.slice(lineEnd),
    selectionStart: newSelectionStart,
    selectionEnd: newSelectionEnd,
  };
}
