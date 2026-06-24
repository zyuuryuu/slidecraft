/**
 * refine.ts — the Harness-directed AI loop (ROADMAP "①③の交点", stage C = distill Lv3).
 *
 * Closes the loop: diagnose ([[deck-diagnostics]]) → apply the DETERMINISTIC levers
 * first (visualize → table; split is already automatic on parse) → hand only the
 * RESIDUE (condense / title) to the AI via the [[slide-fix]] contract → re-diagnose →
 * repeat until converged or maxIterations. The AI is INJECTED (aiFix) so the loop is
 * pure + testable and re-usable by stage D (MCP) with any backend.
 *
 * Three intensity levels: 1 = diagnose only (flag, never transform — 差し戻し),
 * 2 = + deterministic, 3 = + AI. It returns the refined deck AND a change log
 * (before→after per slide) so the caller can show it for review — never silent.
 *
 * Pure logic (R2): no DOM / Tauri. The single AI dependency is the injected callback.
 */

import type { DeckIR, SlideIR } from "./slide-schema";
import type { LayoutCatalog } from "./template-catalog";
import { diagnoseDeck, type DeckIssue, type Lever } from "./deck-diagnostics";
import { contentBodyBox } from "./distill";
import { buildSlideFix, slideFixRequest } from "./slide-fix";
import { visualizeKeyValueMd } from "./slide-rewrite";
import { serializeMd } from "./md-serializer";
import { parseMd } from "./md-parser";
import { autoSelectLayout } from "./template-loader";

export type RefineLevel = 1 | 2 | 3;

/** Outcome of ONE AI fix attempt. The loop's retry policy reads this: success and
 *  cancellation stop further attempts; a `retryable` failure is re-attempted up to the
 *  cap. The host classifies the failure (provider-specific) — the engine just applies
 *  the generic policy. */
export type AiFixOutcome =
  | { ok: true; markdown: string }
  | { ok: false; cancelled: true } // user cancelled → never retry
  | { ok: false; cancelled: false; retryable: boolean; message?: string }; // failed → maybe retry

/** Inject the AI: a slide-fix request (slideFixRequest) → an outcome. `meta.attempt`
 *  (1-based) lets the host label/vary the retry. Keeps the loop pure/testable; stage D
 *  (MCP) re-uses it with a different backend. */
export type AiSlideFix = (
  request: string,
  meta: { slideIndex: number; signal?: AbortSignal; attempt: number },
) => Promise<AiFixOutcome>;

export interface RefineChange {
  slideIndex: number;
  lever: Lever;
  kind: "deterministic" | "ai";
  beforeMd: string;
  afterMd: string;
}

export interface RefineResult {
  deck: DeckIR;
  changes: RefineChange[];
  converged: boolean; // no remaining issues after the loop
  iterations: number;
}

/** Serialize ONE slide to Markdown with its RESOLVED layout (so a lone slide isn't
 *  re-pinned to Title by autoSelect's first-slide rule). */
function slideToMd(deck: DeckIR, idx: number, catalog: LayoutCatalog): string {
  const s = deck.slides[idx];
  const layout = s.layout === "auto" ? autoSelectLayout(s, idx, deck.slides.length, catalog) : s.layout;
  return serializeMd({ slides: [{ ...s, layout }] });
}

function replaceSlide(deck: DeckIR, idx: number, slide: SlideIR): DeckIR {
  const slides = [...deck.slides];
  slides[idx] = slide;
  return { ...deck, slides };
}

function groupBySlide(issues: DeckIssue[]): Map<number, DeckIssue[]> {
  const m = new Map<number, DeckIssue[]>();
  for (const iss of issues) {
    const arr = m.get(iss.slideIndex) ?? [];
    arr.push(iss);
    m.set(iss.slideIndex, arr);
  }
  return m;
}

export async function refineDeck(
  deck: DeckIR,
  catalog: LayoutCatalog,
  opts: { level: RefineLevel; aiFix?: AiSlideFix; maxIterations?: number; maxAiRetries?: number; signal?: AbortSignal },
): Promise<RefineResult> {
  const maxIter = opts.maxIterations ?? 6;
  const maxRetries = opts.maxAiRetries ?? 2; // up to 1 + maxRetries AI attempts per slide
  const box = contentBodyBox(catalog);
  let current = deck;
  const changes: RefineChange[] = [];
  let iterations = 0;
  // Per-slide AI attempt accounting. `aiDone` = slides settled for the run (succeeded,
  // cancelled, non-retryable, or retries exhausted) → never re-submitted (no task spam).
  // `aiAttempts` counts tries so a retryable FAILURE gets another go, up to the cap.
  const aiAttempts = new Map<number, number>();
  const aiDone = new Set<number>();

  for (; iterations < maxIter; iterations++) {
    if (opts.signal?.aborted) break; // user cancelled the loop
    const issues = diagnoseDeck(current, catalog);
    if (issues.length === 0) break; // converged
    if (opts.level < 2) break; // Lv1 = diagnose only (flag, don't transform)

    let changedThisPass = false;
    let pendingRetry = false; // a retryable failure wants another pass
    for (const [idx, slideIssues] of groupBySlide(issues)) {
      if (opts.signal?.aborted) break;
      if (!current.slides[idx]) continue;
      const before = slideToMd(current, idx, catalog);

      // ① Deterministic — a pure key-value list → native table (split is auto on parse).
      const pureKeyValue = slideIssues.some((d) => d.levers.includes("visualize") && !d.levers.includes("split"));
      if (pureKeyValue) {
        const after = visualizeKeyValueMd(before);
        const newSlide = after ? parseMd(after).slides[0] : undefined;
        if (after && newSlide) {
          current = replaceSlide(current, idx, newSlide);
          changes.push({ slideIndex: idx, lever: "visualize", kind: "deterministic", beforeMd: before, afterMd: after });
          changedThisPass = true;
          continue; // one lever per slide per pass; re-diagnose next iteration
        }
      }

      // ② AI residue (Lv3) — condense long sentence-bullets / add a missing title.
      if (opts.level >= 3 && opts.aiFix) {
        const aiIssue = slideIssues.find((d) => d.levers.includes("condense") || d.levers.includes("title"));
        if (aiIssue && !aiDone.has(idx)) {
          const attempt = (aiAttempts.get(idx) ?? 0) + 1;
          aiAttempts.set(idx, attempt);
          let outcome: AiFixOutcome;
          try {
            outcome = await opts.aiFix(slideFixRequest(buildSlideFix(before, slideIssues, box)), { slideIndex: idx, signal: opts.signal, attempt });
          } catch {
            aiDone.add(idx); // aiFix should resolve an outcome; a throw = unknown → don't retry
            continue;
          }
          if (outcome.ok) {
            aiDone.add(idx); // succeeded → settled (even if it didn't fully converge)
            const after = outcome.markdown.trim();
            const newSlide = after && after !== before ? parseMd(after).slides[0] : undefined;
            if (newSlide) {
              current = replaceSlide(current, idx, newSlide);
              changes.push({ slideIndex: idx, lever: aiIssue.levers.includes("title") ? "title" : "condense", kind: "ai", beforeMd: before, afterMd: after });
              changedThisPass = true;
            }
            continue;
          }
          if (outcome.cancelled) {
            aiDone.add(idx); // user cancelled this slide → never retry
            continue;
          }
          // failed: retry only if the host says it's retryable AND the cap isn't reached.
          if (outcome.retryable && attempt < 1 + maxRetries) pendingRetry = true;
          else aiDone.add(idx);
        }
      }
    }
    if (!changedThisPass && !pendingRetry) break; // no progress and nothing to retry → stop
  }

  return { deck: current, changes, converged: diagnoseDeck(current, catalog).length === 0, iterations };
}
