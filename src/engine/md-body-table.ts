/**
 * md-body-table.ts — GFM-table-in-body extraction, shared by md-slide-parser's standard (single-body)
 * and separator (column) parsing paths. Split out of md-slide-parser.ts for R1. Pure logic (R2).
 */
import type { TableBlock } from "./slide-schema";
import { isTableRow, parseMarkdownTable } from "./md-table";
import { trimBodyLines } from "./md-separators";
import { IMAGE_MARKDOWN_RE, unrecognizedMetaKey, type ParseNotice } from "./parse-notice";

/** Find the first GFM table anywhere in `lines` (a `| … |` row + a `|---|` line), plus WHERE it
 *  starts and how many lines it consumed — so the caller can tell whether anything besides that
 *  table (leading prose, a 2nd table, trailing prose) is left over in `lines`. */
export function findTableInLines(lines: string[]): { rows: string[][]; start: number; consumed: number } | null {
  for (let i = 0; i + 1 < lines.length; i++) {
    if (isTableRow(lines[i])) {
      const parsed = parseMarkdownTable(lines.slice(i));
      if (parsed) return { rows: parsed.rows, start: i, consumed: parsed.consumed };
    }
  }
  return null;
}

/**
 * A slide body's GFM table (if any) + whatever text lines are left to merge as body paragraphs.
 *
 * #101 no-silent-drop: a SINGLE table COEXISTS with surrounding prose — the leftover lines are
 * returned (not discarded) for the caller to fold into idx "1" beside the table.
 *
 * #148: a GENUINE 2nd table hiding in the leftover still can't ALSO survive (only one native table
 * per slide today), so THAT specific case keeps the historical drop-with-notice behavior — reported
 * via `notices`, leftover discarded (returned empty). Classifies the dropped leftover (a leaked image
 * line / unrecognized meta key) the same way deck-diagnostics would from surviving body text, since
 * it's the 2nd table collision — not the mere presence of a table — that stops it from surviving.
 */
export function extractBodyTable(
  trimmedBody: string[],
  notices?: ParseNotice[],
): { table?: TableBlock; leftover: string[] } {
  const found = findTableInLines(trimmedBody);
  if (!found) return { leftover: trimmedBody };

  const table: TableBlock = { rows: found.rows, header: true, placeholderIdx: "1" };
  const leftover = trimBodyLines([...trimmedBody.slice(0, found.start), ...trimmedBody.slice(found.start + found.consumed)]);
  if (leftover.length === 0) return { table, leftover };

  if (findTableInLines(leftover)) {
    notices?.push({ kind: "table-dropped" });
    if (leftover.some((l) => IMAGE_MARKDOWN_RE.test(l))) notices?.push({ kind: "image-dropped" });
    const metaKey = leftover.map(unrecognizedMetaKey).find((k): k is string => k !== null);
    if (metaKey) notices?.push({ kind: "meta-key-dropped", detail: metaKey });
    return { table, leftover: [] };
  }
  return { table, leftover };
}
