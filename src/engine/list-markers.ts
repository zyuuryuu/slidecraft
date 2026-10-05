/**
 * list-markers.ts — the Markdown list-item marker, both directions (#394).
 *
 * Pure logic (R2). The ONE place that knows what a list line looks like (R8): the parser
 * (md-slide-parser) and the GUI field editor read markers through matchListItem; the serializer
 * (md-serializer-shared) and the editor write them through orderedNumbers + listItemLine. Nesting
 * depth stays with paragraph-nesting (#103 2-space rule).
 *
 * `-` / `*` → unordered bullet. `N.` / `N)` (1–9 digits, CommonMark) → ORDERED bullet. The number is
 * not kept in the IR — PowerPoint numbers the items (buAutoNum) — so the serializer renumbers each run
 * 1, 2, 3… and `3. a` / `7) b` normalize to `1. a` / `2. b` (stable from the second pass on).
 */
import type { Paragraph } from "./slide-schema";
import { indentForLevel, MAX_NEST_LEVEL } from "./paragraph-nesting";

const LIST_ITEM_RE = /^([-*]|\d{1,9}[.)])\s+(.*)$/;

/** A list item's marker kind + content, or null when the line is not a list item. Expects the line
 *  WITHOUT its leading indent (the caller measures the indent for the level). */
export function matchListItem(line: string): { ordered: boolean; content: string } | null {
  const m = line.match(LIST_ITEM_RE);
  if (!m) return null;
  return { ordered: m[1] !== "-" && m[1] !== "*", content: m[2] };
}

const isBlank = (p: Paragraph) => !p.heading && !p.bullet && p.segments.every((s) => s.text === "");

/** The number each paragraph gets when serialized (0 = not an ordered item). A run counts per level:
 *  deeper items don't interrupt the outer count (`1. a` / `  - x` / `2. b`), a nested run restarts at
 *  1, and a same-or-shallower `-` bullet, plain line or heading ends the run. A blank line does NOT end
 *  it (a CommonMark loose list), so `1. a` / `` / `2. b` keeps its numbers. */
export function orderedNumbers(paragraphs: Paragraph[]): number[] {
  const counts = new Array<number>(MAX_NEST_LEVEL + 1).fill(0);
  const resetFrom = (level: number) => counts.fill(0, level);
  return paragraphs.map((p) => {
    if (!p.bullet) {
      if (!isBlank(p)) resetFrom(0);
      return 0;
    }
    const level = p.level ?? 0;
    resetFrom(level + 1);
    if (!p.ordered) {
      counts[level] = 0;
      return 0;
    }
    return ++counts[level];
  });
}

/** A bullet paragraph's Markdown line: canonical indent (#103) + `- ` or `N. `. */
export function listItemLine(p: Paragraph, n: number, text: string): string {
  return `${indentForLevel(p.level ?? 0)}${p.ordered ? `${n}.` : "-"} ${text}`;
}
