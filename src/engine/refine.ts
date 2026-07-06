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
import { validateCondense, validateStructure, mergeVerdicts } from "./ai-validate";
import { reconcileEdit } from "./ai-reconcile";
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
 *  (1-based) lets the host label/vary the retry; `meta.candidate` (0-based) distinguishes the
 *  best-of-N fan-out within one attempt. Keeps the loop pure/testable; stage D (MCP) re-uses it. */
export type AiSlideFix = (
  request: string,
  meta: { slideIndex: number; signal?: AbortSignal; attempt: number; kind: "condense" | "edit"; candidate?: number },
) => Promise<AiFixOutcome>;

export interface RefineChange {
  slideIndex: number;
  lever: Lever | "edit"; // "edit" = a freeform user instruction (multi-select batch)
  kind: "deterministic" | "ai";
  beforeMd: string;
  afterMd: string;
  /** Non-blocking notices (e.g. a free-form edit changed a number or the language) — shown for review,
   *  never a rejection (ADR-0012: 棄却しない・沈黙しない). */
  warnings?: string[];
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
  opts: { level: RefineLevel; aiFix?: AiSlideFix; maxIterations?: number; maxAiRetries?: number; bestOfN?: number; signal?: AbortSignal },
): Promise<RefineResult> {
  const maxIter = opts.maxIterations ?? 6;
  const maxRetries = opts.maxAiRetries ?? 2; // up to 1 + maxRetries AI attempts per slide
  const bestOfN = Math.max(1, Math.floor(opts.bestOfN ?? 1)); // fan out N per fix, keep the best-scoring
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
          const req = slideFixRequest(buildSlideFix(before, slideIssues, box));
          // Best-of-N: fan out N candidates for this fix and keep the best-scoring one. N=1 = single-shot.
          // The score reuses the SAME verdict the loop already computes: a no-HARD candidate always beats
          // a HARD one; among equals, fewest violations wins. A candidate that throws is dropped.
          const settled = await Promise.all(
            Array.from({ length: bestOfN }, (_, k) =>
              opts.aiFix!(req, { slideIndex: idx, signal: opts.signal, attempt, kind: "condense", candidate: k }).then((o) => o, () => undefined),
            ),
          );
          let best: { after: string; afterSlide?: SlideIR; verdict: ReturnType<typeof mergeVerdicts>; score: number } | undefined;
          let sawCancelled = false, sawRetryable = false;
          for (const outcome of settled) {
            if (!outcome) continue; // threw → unknown, drop this candidate
            if (!outcome.ok) { if (outcome.cancelled) sawCancelled = true; else if (outcome.retryable) sawRetryable = true; continue; }
            const after = outcome.markdown.trim();
            const afterSlide = after ? parseMd(after).slides[0] : undefined;
            // GUARDRAIL: a small model occasionally drops a fact / drifts language / returns the wrong
            // format — AND it can drop the slide's structure (title/figure/group). A condense returns the
            // FULL slide and must preserve both, so merge the fact/language guard with the structure guard
            // ('condense' strictness = every structural loss is HARD).
            const verdict = afterSlide
              ? mergeVerdicts(validateCondense(before, after, box), validateStructure(current.slides[idx], afterSlide, "condense"))
              : validateCondense(before, after, box);
            const score = (verdict.hasHard ? 1e6 : 0) + verdict.violations.length;
            if (!best || score < best.score) best = { after, afterSlide, verdict, score };
          }
          if (!best) {
            // No usable candidate. Cancel → settle; a retryable failure → retry within cap; else settle.
            if (sawCancelled) aiDone.add(idx);
            else if (sawRetryable && attempt < 1 + maxRetries) pendingRetry = true;
            else aiDone.add(idx);
            continue;
          }
          // A HARD violation is rejected + retried; the original is kept on exhaustion (flagged-unconverged,
          // not silently mangled). A clean candidate is reconciled before apply (restores any SOFT loss).
          if (best.verdict.hasHard && attempt < 1 + maxRetries) {
            pendingRetry = true; // even the best candidate still HARD-violates → re-submit next pass
            continue;
          }
          aiDone.add(idx); // succeeded (or retries exhausted) → settled
          const newSlide = best.after && best.after !== before && !best.verdict.hasHard && best.afterSlide ? reconcileEdit(current.slides[idx], best.afterSlide) : undefined;
          if (newSlide) {
            current = replaceSlide(current, idx, newSlide);
            changes.push({ slideIndex: idx, lever: aiIssue.levers.includes("title") ? "title" : "condense", kind: "ai", beforeMd: before, afterMd: best.after });
            changedThisPass = true;
          }
        }
      }
    }
    if (!changedThisPass && !pendingRetry) break; // no progress and nothing to retry → stop
  }

  return { deck: current, changes, converged: diagnoseDeck(current, catalog).length === 0, iterations };
}

/**
 * Multi-select batch edit: apply ONE user instruction to each selected slide and collect
 * the before→after changes for review (RefineProposal). Sequential — one AI task at a
 * time, visible in the task list; a slide whose AI fails or is cancelled is skipped, not
 * fatal. Pure: the AI is injected, so it's testable + re-usable (stage D).
 */
export async function batchEditDeck(
  deck: DeckIR,
  catalog: LayoutCatalog,
  opts: { indices: number[]; instruction: string; aiFix: AiSlideFix; signal?: AbortSignal },
): Promise<RefineResult> {
  let current = deck;
  const changes: RefineChange[] = [];
  for (const idx of opts.indices) {
    if (opts.signal?.aborted) break;
    if (!current.slides[idx]) continue;
    const before = slideToMd(current, idx, catalog);
    try {
      const outcome = await opts.aiFix(`Current slide:\n${before}\n\nInstruction: ${opts.instruction}`, { slideIndex: idx, signal: opts.signal, attempt: 1, kind: "edit" });
      if (!outcome.ok) continue; // cancelled / failed → skip this slide
      const after = outcome.markdown.trim();
      const afterSlide = after && after !== before ? parseMd(after).slides[0] : undefined;
      // A batch instruction is FREE-FORM — it may legitimately change facts or language (e.g. "英語に
      // して"), so we never fact/language-reject it. But it must not silently destroy the slide's
      // STRUCTURE, so reconcile restores any layout pin / title / meta / figure the edit dropped.
      const newSlide = afterSlide ? reconcileEdit(current.slides[idx], afterSlide) : undefined;
      if (newSlide) {
        current = replaceSlide(current, idx, newSlide);
        // Surface (don't reject) a fact/language change so a silent number-swap or translation is caught.
        const cond = validateCondense(before, after);
        const warnings = cond.violations.filter((w) => w.kind === "fact" || w.kind === "language").map((w) => w.detail);
        changes.push({ slideIndex: idx, lever: "edit", kind: "ai", beforeMd: before, afterMd: after, ...(warnings.length ? { warnings } : {}) });
      }
    } catch {
      continue;
    }
  }
  return { deck: current, changes, converged: true, iterations: 1 };
}
