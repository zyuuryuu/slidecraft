/**
 * md-table.ts — GitHub-flavoured Markdown table parsing + serialization.
 *
 * A table is consecutive `| a | b |` rows whose SECOND line is a `|---|---|`
 * separator. Pure string utilities (R2), shared by md-slide-parser (author) and
 * md-serializer (round-trip back to Markdown).
 */

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  // split on UNescaped pipes only, then unescape `\|` → `|`
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function isSeparator(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** A `| … |` table row (not the separator). */
export function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.indexOf("|", 1) !== -1 && !isSeparator(line);
}

/**
 * Parse a contiguous GFM table starting at lines[0]; returns the rectangular rows
 * (header first) + how many lines it consumed, or null if lines[0..1] aren't a table.
 */
export function parseMarkdownTable(lines: string[]): { rows: string[][]; consumed: number } | null {
  if (lines.length < 2 || !isTableRow(lines[0]) || !isSeparator(lines[1])) return null;
  const header = splitRow(lines[0]);
  const ncol = header.length;
  const rows: string[][] = [header];
  let i = 2;
  for (; i < lines.length; i++) {
    if (!isTableRow(lines[i])) break;
    const cells = splitRow(lines[i]);
    while (cells.length < ncol) cells.push(""); // pad short rows so the grid is rectangular
    rows.push(cells.slice(0, ncol));
  }
  return { rows, consumed: i };
}

/** Serialize rows back to a GFM table (header row + separator + body). */
export function tableToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return "";
  const esc = (c: string) => c.replace(/\|/g, "\\|");
  const fmt = (r: string[]) => `| ${r.map(esc).join(" | ")} |`;
  const sep = `| ${Array(rows[0].length).fill("---").join(" | ")} |`;
  const [head, ...body] = rows;
  return [fmt(head), sep, ...body.map(fmt)].join("\n");
}
