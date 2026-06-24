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

/** Inject the AI: a slide-fix request (slideFixRequest) → the fixed slide's Markdown.
 *  `meta.slideIndex` lets the host label the task. Keeps the loop pure/testable; stage
 *  D (MCP) re-uses it with a different backend. */
export type AiSlideFix = (request: string, meta: { slideIndex: number; signal?: AbortSignal }) => Promise<string>;

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
  opts: { level: RefineLevel; aiFix?: AiSlideFix; maxIterations?: number; signal?: AbortSignal },
): Promise<RefineResult> {
  const maxIter = opts.maxIterations ?? 4;
  const box = contentBodyBox(catalog);
  let current = deck;
  const changes: RefineChange[] = [];
  let iterations = 0;
  // One AI attempt per slide per run: a still-flagged slide (cancelled, failed, or just
  // not converged) must NOT be re-submitted next pass — that retries the same prompt and
  // spams the task list. Deterministic levers aren't tracked (they're idempotent).
  const aiAttempted = new Set<number>();

  for (; iterations < maxIter; iterations++) {
    if (opts.signal?.aborted) break; // user cancelled the loop
    const issues = diagnoseDeck(current, catalog);
    if (issues.length === 0) break; // converged
    if (opts.level < 2) break; // Lv1 = diagnose only (flag, don't transform)

    let changedThisPass = false;
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
        if (aiIssue && !aiAttempted.has(idx)) {
          aiAttempted.add(idx); // mark before awaiting — never retry this slide this run
          // One slide's AI failure (or cancel) must not abort the whole batch — skip it.
          let after = "";
          try {
            after = (await opts.aiFix(slideFixRequest(buildSlideFix(before, slideIssues, box)), { slideIndex: idx, signal: opts.signal })).trim();
          } catch {
            continue;
          }
          const newSlide = after && after !== before ? parseMd(after).slides[0] : undefined;
          if (newSlide) {
            current = replaceSlide(current, idx, newSlide);
            changes.push({ slideIndex: idx, lever: aiIssue.levers.includes("title") ? "title" : "condense", kind: "ai", beforeMd: before, afterMd: after });
            changedThisPass = true;
            continue;
          }
        }
      }
    }
    if (!changedThisPass) break; // no progress → stop (don't spin)
  }

  return { deck: current, changes, converged: diagnoseDeck(current, catalog).length === 0, iterations };
}
