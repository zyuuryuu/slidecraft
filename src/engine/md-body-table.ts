/**
 * md-body-table.ts — GFM-table-in-body extraction, shared by md-slide-parser's standard (single-body)
 * and separator (column) parsing paths. Split out of md-slide-parser.ts for R1. Pure logic (R2).
 */
import type { TableBlock } from "./slide-schema";
import { isTableRow, parseMarkdownTable } from "./md-table";
import { trimBodyLines } from "./md-separators";

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
 * A slide body's GFM tables (#392: ALL of them, each with the line it starts at in `trimmedBody`, so the
 * parser can order them against the slide's fenced figures) + whatever text lines are left to merge as
 * body paragraphs.
 *
 * #101 no-silent-drop: tables COEXIST with surrounding prose — the leftover lines (before, between and
 * after the tables, in order) are returned for the caller to fold into idx "1" beside the tables.
 * (Before #392 a 2nd table could not survive, so it and the leftover were dropped with a
 * `table-dropped` notice, #148 — the SlideIR now keeps every table in `figures`.)
 */
export function extractBodyTables(trimmedBody: string[]): { tables: { table: TableBlock; start: number }[]; leftover: string[] } {
  const tables: { table: TableBlock; start: number }[] = [];
  const rest: string[] = [];
  for (let i = 0; i < trimmedBody.length; ) {
    const parsed = isTableRow(trimmedBody[i]) ? parseMarkdownTable(trimmedBody.slice(i)) : null;
    if (parsed) {
      tables.push({ table: { rows: parsed.rows, header: true, placeholderIdx: "1" }, start: i });
      i += parsed.consumed;
    } else {
      rest.push(trimmedBody[i++]);
    }
  }
  return { tables, leftover: tables.length > 0 ? trimBodyLines(rest) : trimmedBody };
}
