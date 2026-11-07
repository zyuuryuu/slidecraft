/**
 * deck-plan-violations.ts — the "floor" for AI deck generation: drop text units poisoned by an
 * unrecoverable character, prune noise, and report it (never-silent). Split out of deck-plan.ts (R1)
 * and decomposed into draft → finalize so Issue #107 can regenerate ONLY the violating slides in
 * between. `extractDeckPlan` is `finalizeDeckDraft(draft)` with no retries — one floor path (R8).
 *
 * Pure (R2). Imports deck-plan only for TYPES, so there is no runtime import cycle.
 */
import type { SlidePlan, ParseResult } from "./deck-plan";

// U+FFFD is json-salvage's marker for an unrecoverable character (a malformed \uXXXX or a lone
// surrogate). It must NEVER reach a slide — treat any text carrying it as a format violation.
const CORRUPT = "\uFFFD";
const hasCorrupt = (v: string | undefined): boolean => !!v && v.includes(CORRUPT);

/**
 * Drop, at the SMALLEST grain, any text unit poisoned by U+FFFD. A weak model that violated the
 * "raw UTF-8, never \uXXXX" instruction produced untrustworthy text — reject the offending bullet /
 * field (a scalar field is blanked; a list item is removed; a table cell is blanked to keep the grid)
 * rather than ship a `�` marker or a silently-wrong word. Returns the cleaned slide + units dropped.
 */
export function stripViolations(s: SlidePlan): { slide: SlidePlan; dropped: number } {
  let dropped = 0;
  const scalar = (v: string): string => {
    if (hasCorrupt(v)) { dropped++; return ""; }
    return v;
  };
  const opt = (v: string | undefined): string | undefined => (v === undefined ? undefined : scalar(v));
  const list = (arr: string[]): string[] => {
    const kept = arr.filter((x) => !hasCorrupt(x));
    dropped += arr.length - kept.length;
    return kept;
  };
  let slide: SlidePlan;
  switch (s.kind) {
    case "title":
      slide = { ...s, title: scalar(s.title), subtitle: opt(s.subtitle), category: opt(s.category), date: opt(s.date), footer: opt(s.footer) };
      break;
    case "section":
      slide = { ...s, title: scalar(s.title) };
      break;
    case "content":
      slide = { ...s, title: scalar(s.title), subtitle: opt(s.subtitle), bullets: list(s.bullets) };
      break;
    case "columns":
      slide = { ...s, title: scalar(s.title), subtitle: opt(s.subtitle),
        columns: s.columns.map((c) => ({ heading: opt(c.heading), bullets: list(c.bullets) })) };
      break;
    case "table":
      slide = { ...s, title: scalar(s.title), subtitle: opt(s.subtitle),
        headers: s.headers.map(scalar), rows: s.rows.map((r) => r.map(scalar)) };
      break;
    case "diagram":
      // mermaid is structural (a corrupt char can't be removed without breaking syntax) — left intact.
      slide = { ...s, title: scalar(s.title), subtitle: opt(s.subtitle) };
      break;
    case "closing":
      slide = { ...s, title: scalar(s.title), subtitle: opt(s.subtitle), bullets: list(s.bullets) };
      break;
  }
  return { slide, dropped };
}

/** A slide carries no content — pure noise a weak model emitted. Title-only slides are NOT empty
 *  (a title/section IS the content); this only catches slides with neither a title nor a body. */
export function isEmptyPlan(s: SlidePlan): boolean {
  if (s.title.trim()) return false;
  switch (s.kind) {
    case "title": return !s.subtitle && !s.category && !s.date && !s.footer;
    case "section": return true; // no title → an empty divider
    case "content": return s.bullets.length === 0 && !s.subtitle;
    case "columns": return s.columns.every((c) => !c.heading && c.bullets.length === 0);
    case "table": return s.headers.length === 0 && s.rows.length === 0;
    case "diagram": return !s.mermaid.trim();
    case "closing": return !s.subtitle && s.bullets.length === 0;
  }
}

/** Drop noise a weak model repeats: empty-title section dividers and slides with no content at all,
 *  and collapse consecutive duplicate section titles (`第1部` / `第1部` → one). Preserves everything
 *  that carries data. */
function cleanupSlidePlans(slides: SlidePlan[]): SlidePlan[] {
  const out: SlidePlan[] = [];
  for (const s of slides) {
    if (isEmptyPlan(s)) continue;
    if (s.kind === "section") {
      const prev = out[out.length - 1];
      if (prev && prev.kind === "section" && prev.title.trim() === s.title.trim()) continue;
    }
    out.push(s);
  }
  return out;
}

// ── draft → finalize (Issue #107) ──

/** A slide whose text units were dropped by the floor. `index` is its position in `draft.slides`. */
export interface SlideViolation { index: number; dropped: number }

/** The deck after violation-drop but BEFORE noise pruning, so slide positions are stable for
 *  per-slide regeneration (a fully-corrupted slide is still addressable here). */
export interface DeckPlanDraft { slides: SlidePlan[]; violations: SlideViolation[] }

export type DraftResult = { ok: true; draft: DeckPlanDraft } | { ok: false; error: string };

/** The outcome of the ONE regeneration attempt for a violating slide: `slide` set = accepted
 *  replacement; absent = the attempt failed (still violating / unparseable / call error). */
export interface SlideRetryOutcome { index: number; slide?: SlidePlan }

/** Strip every slide and record which ones had violations. */
export function stripDeck(slides: SlidePlan[]): DeckPlanDraft {
  const violations: SlideViolation[] = [];
  const stripped = slides.map((s, index) => {
    const r = stripViolations(s);
    if (r.dropped > 0) violations.push({ index, dropped: r.dropped });
    return r.slide;
  });
  return { slides: stripped, violations };
}

/**
 * Apply accepted replacements, prune noise, and build the notices. With no outcomes this is exactly
 * the pre-#107 floor (same plan, same notice). Notices stay truthful: the "除外しました" count covers
 * only slides NOT replaced, and any retry is reported with its result (never-silent).
 */
export function finalizeDeckDraft(draft: DeckPlanDraft, outcomes: SlideRetryOutcome[] = []): ParseResult {
  const replaced = new Map<number, SlidePlan>();
  for (const o of outcomes) if (o.slide) replaced.set(o.index, o.slide);
  const slides = draft.slides.map((s, i) => replaced.get(i) ?? s);
  const cleaned = cleanupSlidePlans(slides);
  if (cleaned.length === 0) return { ok: false, error: "No usable slides in the generated plan." };
  const dropped = draft.violations.reduce((n, v) => n + (replaced.has(v.index) ? 0 : v.dropped), 0);
  const notices: string[] = [];
  if (dropped > 0) notices.push(`書式違反（復元不能な文字）により ${dropped} か所を除外しました。`);
  if (outcomes.length > 0) {
    const failed = outcomes.length - replaced.size;
    notices.push(`書式違反のあった ${outcomes.length} 枚を 1 回ずつ再生成しました（差し替え ${replaced.size} 枚` +
      (failed > 0 ? `・${failed} 枚は再生成でも直らず除外のまま` : "") + "）。");
  }
  return { ok: true, plan: { slides: cleaned }, ...(notices.length ? { notices } : {}) };
}
