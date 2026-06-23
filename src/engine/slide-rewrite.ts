/**
 * slide-rewrite.ts — DETERMINISTIC per-issue fixes applied at the Markdown level.
 *
 * The granular half of the harness loop (ROADMAP "①③の交点", stage C): a single
 * diagnostic ([[deck-diagnostics]]) can be fixed on its own, mechanically, by
 * rewriting just that slide's Markdown span — no AI, instantly, undoable. The
 * caller splices the result back into the source via the slide's sourceLine range.
 *
 * Levers split by nature: visualize/split are deterministic (here); condense/title
 * need the AI contract ([[slide-fix]]). This module holds the deterministic ones.
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import { keyValueTable } from "./manuscript";

const BULLET = /^[-*+]\s+/;

/**
 * Convert a slide's key-value bullet list to a native table (the VISUALIZE lever),
 * operating on the slide's source Markdown span. Finds the contiguous bullet run,
 * replaces it with a GFM table, and keeps the heading / subtitle / spacing around it.
 * Returns null when there's no all-key-value bullet run to convert.
 */
export function visualizeKeyValueMd(spanText: string): string | null {
  const lines = spanText.split("\n");
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (BULLET.test(t)) {
      if (start === -1) start = i;
      end = i;
    } else if (start !== -1 && t !== "") {
      break; // a non-blank, non-bullet line ends the run
    }
  }
  if (start === -1) return null;

  const bullets = lines
    .slice(start, end + 1)
    .filter((l) => l.trim())
    .map((l) => `- ${l.trim().replace(BULLET, "")}`)
    .join("\n");
  const table = keyValueTable(bullets);
  if (!table) return null;

  return [...lines.slice(0, start), ...table.split("\n"), ...lines.slice(end + 1)].join("\n");
}
