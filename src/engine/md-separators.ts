/**
 * md-separators.ts — Column / KPI / step separator detection + line trimming for
 * a slide body (`<!-- col -->` / `<!-- kpi -->` / `<!-- step -->` / `<!-- card -->` / `<!-- compare -->`,
 * and the `<!-- before -->` / `<!-- after -->` pair). Split from md-slide-parser.ts for R1. Pure string
 * utilities, no imports.
 */
// ── Detect separator type in lines ──

export type SeparatorType = "col" | "kpi" | "step" | "card" | "compare" | "beforeAfter";

/** #402: `<!-- before -->` and `<!-- after -->` are ONE separator family (beforeAfter) — either word
 *  opens a region. Meaning is POSITIONAL (beforeAfterRole): the serializer writes the words back in that
 *  order (groupMarkerLine) and the overlay labels the regions with it (before-after.ts). */
const BEFORE_AFTER = "(?:before|after)";

/** The role of region `ordinal` (1-based) in a before/after group — region 1 is Before, every later one
 *  After. The ONE definition of that mapping (R8): marker write-back and role labels both read it. */
export function beforeAfterRole(ordinal: number): "before" | "after" {
  return ordinal === 1 ? "before" : "after";
}

export function detectSeparator(lines: string[]): SeparatorType | null {
  for (const line of lines) {
    const m = line.trim().match(/^<!--\s*(col|kpi|step|card|compare|before|after)\s*-->$/);
    if (m) return m[1] === "before" || m[1] === "after" ? "beforeAfter" : (m[1] as SeparatorType);
  }
  return null;
}

// ── Split lines by separator comment ──

export function splitBySeparator(
  lines: string[],
  sepType: SeparatorType,
): string[][] {
  const pattern = new RegExp(`^<!--\\s*${sepType === "beforeAfter" ? BEFORE_AFTER : sepType}\\s*-->$`);
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
