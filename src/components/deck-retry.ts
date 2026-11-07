/**
 * deck-retry.ts — Issue #107: post-process an AI response, regenerating ONLY the deck slides the floor
 * had to strip (a weak model's malformed \uXXXX), at most ONCE each.
 *
 * The LLM call is injected (`regenerate`), so this stays framework-free and unit-testable with a stub;
 * the hook (useAiGeneration) binds it to generateWithAI in "slide-retry" mode. The decisions are pure
 * engine functions: what to retry (draftDeckPlan's violations), the request text (slideRetryRequest),
 * acceptance (acceptSlideRetry) and splicing + notices (finalizeDeckDraft). A clean deck never calls
 * `regenerate` and is shaped by the same helper as before, so its output is byte-identical.
 */
import type { LayoutCatalog } from "../engine/template-catalog";
import { draftDeckPlan } from "../engine/deck-plan";
import { finalizeDeckDraft, type SlideRetryOutcome } from "../engine/deck-plan-violations";
import { slideRetryRequest, acceptSlideRetry } from "../engine/deck-plan-retry";
import { postProcessAiResult, shapeDeckResult, type AiMode } from "./ai-generation-types";

export interface RetryContext {
  /** The user's original deck request (topic + language) — reused as context for the one-slide prompt. */
  userRequest: string;
  /** One "slide-retry" LLM call: the user message in, the raw model text out. */
  regenerate: (userRequest: string) => Promise<string>;
  /** The task's abort signal: a cancel during a retry cancels the task (never swallowed as a failure). */
  signal?: AbortSignal;
}

export async function postProcessWithRetry(
  mode: AiMode, raw: string, catalog: LayoutCatalog | undefined, ctx: RetryContext,
): Promise<{ result?: string; error?: string; notice?: string }> {
  if (mode !== "slides") return postProcessAiResult(mode, raw, catalog);
  const d = draftDeckPlan(raw);
  if (!d.ok) return shapeDeckResult(d, catalog);
  const outcomes: SlideRetryOutcome[] = [];
  // Sequential on purpose: a local runtime serves one request at a time, and the call count is
  // bounded by the number of violating slides (one attempt each — never a loop).
  for (const v of d.draft.violations) {
    let text: string;
    try {
      text = await ctx.regenerate(slideRetryRequest(ctx.userRequest, d.draft, v.index));
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      outcomes.push({ index: v.index }); // call failed → keep the floor result for this slide
      continue;
    }
    const slide = acceptSlideRetry(text);
    outcomes.push(slide ? { index: v.index, slide } : { index: v.index });
  }
  return shapeDeckResult(finalizeDeckDraft(d.draft, outcomes), catalog);
}
