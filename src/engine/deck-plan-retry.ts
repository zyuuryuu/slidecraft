/**
 * deck-plan-retry.ts — Issue #107: regenerate ONLY the slides the floor had to strip (a weak model's
 * malformed \uXXXX), at most ONCE each. This module is the pure half (R2): it builds the one-slide
 * request and decides whether a regenerated slide is acceptable. The LLM call itself lives in
 * components/deck-retry.ts; applying the outcomes is `finalizeDeckDraft` (deck-plan-violations.ts).
 */
import { parseSlidePlanRaw, type SlidePlan } from "./deck-plan";
import { stripViolations, isEmptyPlan, type DeckPlanDraft } from "./deck-plan-violations";

/**
 * The USER message for regenerating slide `index` of `draft` (paired with slideRetrySystemPrompt).
 * Carries the original request (topic + language), the deck outline for context, and what survived
 * of the slide. The draft is already stripped, so no U+FFFD marker is ever echoed back to the model.
 */
export function slideRetryRequest(userRequest: string, draft: DeckPlanDraft, index: number): string {
  const target = draft.slides[index];
  const outline = draft.slides
    .map((s, i) => `${i + 1}. [${s.kind}] ${s.title || "(untitled)"}${i === index ? "   ← regenerate this one" : ""}`)
    .join("\n");
  return [
    "Original request for the whole deck:",
    userRequest,
    "",
    "Deck outline:",
    outline,
    "",
    `Regenerate ONLY slide ${index + 1} (kind "${target.kind}"). Its previous output contained broken escape`,
    "sequences, so some of its text was lost. What survived (use it as a guide; restore the missing parts):",
    JSON.stringify(target),
  ].join("\n");
}

/**
 * Accept a regenerated slide only if it parses AND is clean: any remaining violation (or an empty
 * slide) rejects it, so the caller keeps the floor result and its notice instead of silently
 * shipping a second, quietly-stripped version.
 */
export function acceptSlideRetry(text: string): SlidePlan | null {
  const r = parseSlidePlanRaw(text);
  if (!r.ok) return null;
  if (stripViolations(r.slide).dropped > 0) return null;
  return isEmptyPlan(r.slide) ? null : r.slide;
}
