/**
 * md-separators.ts — Column / KPI / step separator detection + line trimming for
 * a slide body (`<!-- col -->` / `<!-- kpi -->` / `<!-- step -->` / `<!-- card -->` / `<!-- compare -->`,
 * and the `<!-- before -->` / `<!-- after -->` pair). Split from md-slide-parser.ts for R1. Pure string
 * utilities, no imports.
 */
// ── Detect separator type in lines ──

export type SeparatorType = "col" | "kpi" | "step" | "card" | "compare" | "beforeAfter";

/** The role of region `ordinal` (1-based) in a before/after group — region 1 is Before, every later one
 *  After. The ONE definition of that mapping (R8): marker write-back and role labels both read it. */
export function beforeAfterRole(ordinal: number): "before" | "after" {
  return ordinal === 1 ? "before" : "after";
}

/** A separator line: `<!-- col|kpi|step|card|compare|before|after -->`, or `<!-- step * -->` — a step
 *  marked as the CURRENT step (#401). Only `step` takes the `*`; `<!-- card * -->` etc. stay
 *  non-separators (the pre-#401 behaviour). `before`/`after` are ONE family (beforeAfter, #402):
 *  either word opens a region, meaning is POSITIONAL (beforeAfterRole). */
function matchSeparator(line: string): { type: SeparatorType; current: boolean } | null {
  const m = line.trim().match(/^<!--\s*(col|kpi|step|card|compare|before|after)\s*(\*)?\s*-->$/);
  if (!m || (m[2] && m[1] !== "step")) return null;
  const type = m[1] === "before" || m[1] === "after" ? "beforeAfter" : (m[1] as SeparatorType);
  return { type, current: !!m[2] };
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
 *  carried the current-step `*` (#401; always empty for non-step kinds). `leading` is the lines
 *  BEFORE the first separator: they are still dropped (title/subtitle were consumed upstream, and
 *  treating the rest as section 1 is a separate call, #451 案 2), but the caller can now see them —
 *  a non-blank leading line means body text the author will lose (#451). */
export function splitBySeparator(
  lines: string[],
  sepType: SeparatorType,
): { sections: string[][]; currentSections: number[]; leading: string[] } {
  const sections: string[][] = [];
  const currentSections: number[] = [];
  const leading: string[] = [];
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
    } else {
      leading.push(line); // before the first separator — dropped, but reported via `leading` (#451)
    }
  }

  if (inSection) {
    sections.push(current);
  }

  return { sections, currentSections, leading };
}

// ── Trim leading/trailing empty lines from body ──

export function trimBodyLines(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  let end = lines.length;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}
