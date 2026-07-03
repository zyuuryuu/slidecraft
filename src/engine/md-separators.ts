/**
 * md-separators.ts — Column / KPI / step separator detection + line trimming for
 * a slide body (`<!-- col -->` / `<!-- kpi -->` / `<!-- step -->`). Split from
 * md-slide-parser.ts for R1. Pure string utilities, no imports.
 */
// ── Detect separator type in lines ──

export type SeparatorType = "col" | "kpi" | "step" | "card";

export function detectSeparator(lines: string[]): SeparatorType | null {
  for (const line of lines) {
    const m = line.trim().match(/^<!--\s*(col|kpi|step|card)\s*-->$/);
    if (m) return m[1] as SeparatorType;
  }
  return null;
}

// ── Split lines by separator comment ──

export function splitBySeparator(
  lines: string[],
  sepType: SeparatorType,
): string[][] {
  const pattern = new RegExp(`^<!--\\s*${sepType}\\s*-->$`);
  const sections: string[][] = [];
  let current: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (pattern.test(line.trim())) {
      if (inSection) {
        sections.push(current);
      }
      current = [];
      inSection = true;
    } else if (inSection) {
      current.push(line);
    }
    // Lines before the first separator are skipped (already parsed as title/subtitle)
  }

  if (inSection) {
    sections.push(current);
  }

  return sections;
}

// ── Trim leading/trailing empty lines from body ──

export function trimBodyLines(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  let end = lines.length;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}
