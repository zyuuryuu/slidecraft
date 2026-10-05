/**
 * md-separators.ts — Column / KPI / step separator detection + line trimming for
 * a slide body (`<!-- col -->` / `<!-- kpi -->` / `<!-- step -->`). Split from
 * md-slide-parser.ts for R1. Pure string utilities, no imports.
 */
// ── Detect separator type in lines ──

export type SeparatorType = "col" | "kpi" | "step" | "card";

/** A separator line: `<!-- col|kpi|step|card -->`, or `<!-- step * -->` — a step marked as the
 *  CURRENT step (#401). Only `step` takes the `*`; `<!-- card * -->` etc. stay non-separators
 *  (the pre-#401 behaviour). */
function matchSeparator(line: string): { type: SeparatorType; current: boolean } | null {
  const m = line.trim().match(/^<!--\s*(col|kpi|step|card)\s*(\*)?\s*-->$/);
  if (!m || (m[2] && m[1] !== "step")) return null;
  return { type: m[1] as SeparatorType, current: !!m[2] };
}

export function detectSeparator(lines: string[]): SeparatorType | null {
  for (const line of lines) {
    const m = matchSeparator(line);
    if (m) return m.type;
  }
  return null;
}

// ── Split lines by separator comment ──

/** Sections between `sepType` separators, plus the 1-based ordinals of the sections whose separator
 *  carried the current-step `*` (#401; always empty for non-step kinds). */
export function splitBySeparator(
  lines: string[],
  sepType: SeparatorType,
): { sections: string[][]; currentSections: number[] } {
  const sections: string[][] = [];
  const currentSections: number[] = [];
  let current: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const sep = matchSeparator(line);
    if (sep && sep.type === sepType) {
      if (inSection) {
        sections.push(current);
      }
      current = [];
      inSection = true;
      if (sep.current) currentSections.push(sections.length + 1);
    } else if (inSection) {
      current.push(line);
    }
    // Lines before the first separator are skipped (already parsed as title/subtitle)
  }

  if (inSection) {
    sections.push(current);
  }

  return { sections, currentSections };
}

// ── Trim leading/trailing empty lines from body ──

export function trimBodyLines(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  let end = lines.length;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}
