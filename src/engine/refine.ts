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
import { serializeMd, type SerializeTemplate } from "./md-serializer";
import { parseMd } from "./md-parser";
import { autoSelectLayout } from "./template-loader";
import { slideEditUserPrompt } from "./deck-plan-prompts";
import { describeEditableFields } from "./field-edit-ops";
import { describeEditableData } from "./chart-edit-ops";
import { routeOpsReply, OPS_ROUTES, type SlideEditRoute, type RoutedSlideEdit } from "./slide-edit-route";

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

/** Which route an AI reply for one slide took (#106 P4) — the host shows / records it. `applied` = the
 *  reply became a change; `notices` (skipped ops, malformed-ops fallback) only on an unapplied reply,
 *  since an applied one carries them in its RefineChange.warnings. */
export interface RouteRecord {
  slideIndex: number;
  route: SlideEditRoute;
  skipped: number;
  applied: boolean;
  notices?: string[];
}

export interface RefineResult {
  deck: DeckIR;
  changes: RefineChange[];
  converged: boolean; // no remaining issues after the loop
  iterations: number;
  /** One record per settled AI reply (#106 P4). Absent when no AI reply was settled (Lv1/Lv2). */
  routes?: RouteRecord[];
}

/** An AI reply read as a candidate slide. An ops reply (bare JSON array that a route accepts) is merged
 *  into `slide` by routeSlideEdit and serialized; any other reply keeps the Markdown path (parsed later
 *  by the caller, byte-identical to before P4). A malformed ops array is Markdown with the fallback notice. */
interface ReadReply { after: string; merged?: SlideIR; route: SlideEditRoute; notices: string[]; skipped: number }
function readReply(deck: DeckIR, idx: number, raw: string, catalog: LayoutCatalog, tpl?: SerializeTemplate, instruction?: string): ReadReply {
  const r: RoutedSlideEdit | null = routeOpsReply(deck.slides[idx], raw, instruction);
  if (r && r.slide && OPS_ROUTES.has(r.route)) {
    return { after: slideToMd(replaceSlide(deck, idx, r.slide), idx, catalog, tpl), merged: r.slide, route: r.route, notices: r.notices, skipped: r.skipped };
  }
  const fallback = r?.route === "fallback";
  return { after: raw.trim(), route: fallback ? "fallback" : "markdown", notices: fallback ? r.notices : [], skipped: 0 };
}

const record = (slideIndex: number, r: ReadReply, applied: boolean): RouteRecord =>
  ({ slideIndex, route: r.route, skipped: r.skipped, applied, ...(!applied && r.notices.length > 0 ? { notices: r.notices } : {}) });


/** Serialize ONE slide to Markdown with its RESOLVED layout (so a lone slide isn't
 *  re-pinned to Title by autoSelect's first-slide rule). ADR-0030 stage B (#155): `tpl` hands the
 *  serializer the binding authority so a closing-vocabulary title isn't dropped from the AI's
 *  before-md by the name-based namespace fork. */
function slideToMd(deck: DeckIR, idx: number, catalog: LayoutCatalog, tpl?: SerializeTemplate): string {
  const s = deck.slides[idx];
  // Unconditional (#435): a pin this template has is returned as-is; one it lacks degrades exactly as export does.
  const layout = autoSelectLayout(s, idx, deck.slides.length, catalog);
  return serializeMd({ slides: [{ ...s, layout }] }, tpl);
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
  // `tpl` feeds ONLY the slide serialization (before/after md) — the convergence condition stays
  // diagnoseDeck(deck, catalog) untouched (the diagnostics `layouts` wiring is a separate concern).
  opts: { level: RefineLevel; aiFix?: AiSlideFix; maxIterations?: number; maxAiRetries?: number; bestOfN?: number; signal?: AbortSignal; tpl?: SerializeTemplate },
): Promise<RefineResult> {
  const maxIter = opts.maxIterations ?? 6;
  const maxRetries = opts.maxAiRetries ?? 2; // up to 1 + maxRetries AI attempts per slide
  const bestOfN = Math.max(1, Math.floor(opts.bestOfN ?? 1)); // fan out N per fix, keep the best-scoring
  const box = contentBodyBox(catalog);
  let current = deck;
  const changes: RefineChange[] = [];
  const routes: RouteRecord[] = [];
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
      const before = slideToMd(current, idx, catalog, opts.tpl);

      // ① Deterministic — a pure key-value list → native table (split is auto on parse).
      const pureKeyValue = slideIssues.some((d) => d.levers.includes("visualize") && !d.levers.includes("split"));
      if (pureKeyValue) {
        const after = visualizeKeyValueMd(before);
        const newSlide = after ? parseMd(after, catalog).slides[0] : undefined;
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
          let best: { after: string; afterSlide?: SlideIR; verdict: ReturnType<typeof mergeVerdicts>; score: number; read: ReadReply } | undefined;
          let sawCancelled = false, sawRetryable = false;
          for (const outcome of settled) {
            if (!outcome) continue; // threw → unknown, drop this candidate
            if (!outcome.ok) { if (outcome.cancelled) sawCancelled = true; else if (outcome.retryable) sawRetryable = true; continue; }
            // #106 P4: an ops reply (e.g. one setField shortening a bullet) is merged and scored as the slide it makes.
            const read = readReply(current, idx, outcome.markdown, catalog, opts.tpl);
            const after = read.after;
            const afterSlide = read.merged ?? (after ? parseMd(after, catalog).slides[0] : undefined);
            // GUARDRAIL: a small model occasionally drops a fact / drifts language / returns the wrong
            // format — AND it can drop the slide's structure (title/figure/group). A condense returns the
            // FULL slide and must preserve both, so merge the fact/language guard with the structure guard
            // ('condense' strictness = every structural loss is HARD).
            const verdict = afterSlide
              ? mergeVerdicts(validateCondense(before, after, box), validateStructure(current.slides[idx], afterSlide, "condense", catalog))
              : validateCondense(before, after, box);
            const score = (verdict.hasHard ? 1e6 : 0) + verdict.violations.length;
            if (!best || score < best.score) best = { after, afterSlide, verdict, score, read };
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
          // An ops merge already kept every untouched part verbatim — reconcile only the Markdown rewrite.
          const usable = best.after && best.after !== before && !best.verdict.hasHard && best.afterSlide;
          const newSlide = usable ? (best.read.merged ?? reconcileEdit(current.slides[idx], best.afterSlide!)) : undefined;
          routes.push(record(idx, best.read, !!newSlide));
          if (newSlide) {
            current = replaceSlide(current, idx, newSlide);
            const notices = best.read.notices;
            changes.push({ slideIndex: idx, lever: aiIssue.levers.includes("title") ? "title" : "condense", kind: "ai", beforeMd: before, afterMd: best.after, ...(notices.length ? { warnings: notices } : {}) });
            changedThisPass = true;
          }
        }
      }
    }
    if (!changedThisPass && !pendingRetry) break; // no progress and nothing to retry → stop
  }

  return { deck: current, changes, converged: diagnoseDeck(current, catalog).length === 0, iterations, ...(routes.length ? { routes } : {}) };
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
  opts: { indices: number[]; instruction: string; aiFix: AiSlideFix; bestOfN?: number; signal?: AbortSignal; tpl?: SerializeTemplate },
): Promise<RefineResult> {
  const bestOfN = Math.max(1, Math.floor(opts.bestOfN ?? 1));
  let current = deck;
  const changes: RefineChange[] = [];
  const routes: RouteRecord[] = [];
  for (const idx of opts.indices) {
    if (opts.signal?.aborted) break;
    const slide = current.slides[idx];
    if (!slide) continue;
    const before = slideToMd(current, idx, catalog, opts.tpl);
    // The AI panel's request (R8, #106 P4): the slide plus the setField idx list and the table / chart
    // listing, so the model can answer with ops instead of rewriting the whole slide.
    const req = slideEditUserPrompt(before, describeEditableFields(slide), opts.instruction, describeEditableData(slide));
    // Best-of-N: fan out N candidates. A FREE-FORM edit has no preserve-contract (the instruction may
    // legitimately change language, e.g. "英語にして"), so we can't score by HARD violations like the
    // condense loop does. Instead pick the candidate that ACTUALLY applied the edit (after !== before)
    // with the FEWEST numeric drifts — a dropped/changed number is almost always collateral damage,
    // whatever the instruction. Language drift is NOT penalized (it may be the intent). Ties → first.
    const settled = await Promise.all(
      Array.from({ length: bestOfN }, (_, k) =>
        opts.aiFix(req, { slideIndex: idx, signal: opts.signal, attempt: 1, kind: "edit", candidate: k }).then((o) => o, () => undefined),
      ),
    );
    let best: { after: string; afterSlide: SlideIR; warnings: string[]; read: ReadReply } | undefined;
    let bestScore = Infinity;
    let miss: ReadReply | undefined; // the first reply that made no candidate — recorded if none did
    for (const outcome of settled) {
      if (!outcome || !outcome.ok) continue; // threw / cancelled / failed
      const read = readReply(current, idx, outcome.markdown, catalog, opts.tpl, opts.instruction);
      const after = read.after;
      // no-op → the edit wasn't applied, not a real candidate (ops: every op skipped / changed nothing)
      const afterSlide = !after || after === before ? undefined : read.merged ?? parseMd(after, catalog).slides[0];
      if (!afterSlide) { miss ??= read; continue; }
      const cond = validateCondense(before, after);
      const factDrift = cond.violations.filter((w) => w.kind === "fact").length;
      if (factDrift < bestScore) {
        bestScore = factDrift;
        // Surface (don't reject) fact/language changes so a silent number-swap or translation is caught;
        // skipped ops / a malformed-ops fallback come first (never silent, #106 P4).
        const drift = cond.violations.filter((w) => w.kind === "fact" || w.kind === "language").map((w) => w.detail);
        best = { after, afterSlide, warnings: [...read.notices, ...drift], read };
      }
    }
    if (!best) { if (miss) routes.push(record(idx, miss, false)); continue; } // non-fatal skip, as before
    // reconcile restores any layout pin / title / meta / figure a Markdown edit dropped (structure not
    // rejected); an ops merge kept every untouched part verbatim already.
    const newSlide = best.read.merged ?? reconcileEdit(current.slides[idx], best.afterSlide);
    routes.push(record(idx, best.read, !!newSlide));
    if (newSlide) {
      current = replaceSlide(current, idx, newSlide);
      changes.push({ slideIndex: idx, lever: "edit", kind: "ai", beforeMd: before, afterMd: best.after, ...(best.warnings.length ? { warnings: best.warnings } : {}) });
    }
  }
  return { deck: current, changes, converged: true, iterations: 1, ...(routes.length ? { routes } : {}) };
}
