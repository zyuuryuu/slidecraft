/**
 * paragraph-nesting.ts — nested-bullet indent level helpers (#103).
 *
 * Pure logic (R2): indent-width → level mapping, shared by the parser (leading
 * whitespace → level) and the serializer/editor (level → canonical indent), so
 * both directions agree exactly and a rounded/clamped level re-serializes to an
 * indent that reparses to the SAME level (round-trip stability).
 */

/** Deepest supported nesting level. Anything past this CLAMPS (no-silent-drop: the
 *  bullet's content is kept, just flattened to the deepest level) rather than erroring. */
export const MAX_NEST_LEVEL = 3;

/** Leading-whitespace width of a line, in "spaces" (a tab counts as 2 — templates rarely
 *  mix the two, and this only affects the rare tab-indented author). */
export function measureIndent(line: string): number {
  const ws = line.match(/^[ \t]*/)?.[0] ?? "";
  let width = 0;
  for (const ch of ws) width += ch === "\t" ? 2 : 1;
  return width;
}

/** Indent width → nesting level. 2 spaces per level (2/4/6 → 1/2/3); anything at or past
 *  8 spaces clamps to MAX_NEST_LEVEL instead of growing unbounded. */
export function levelFromIndent(indentWidth: number): number {
  const level = Math.floor(indentWidth / 2);
  return Math.min(Math.max(level, 0), MAX_NEST_LEVEL);
}

/** Canonical indent string for a level (2 spaces/level) — the serializer always emits this,
 *  regardless of the original input's exact indent width, so a clamped/rounded level is
 *  stable on the next parse. */
export function indentForLevel(level: number): string {
  return "  ".repeat(level);
}
