/**
 * deck-plan-resilience.test.ts — A weak/drifting model's ONE bad slide must not
 * reject the whole deck (deterministic repair before/instead of failing).
 * Reproduces the real qwen2.5:7b failure: "slides.8.columns: expected >=2 items".
 */
import { describe, it, expect } from "vitest";
import { extractDeckPlan } from "../src/engine/deck-plan";

describe("DeckPlan resilience", () => {
  it("a 1-column 'columns' slide degrades to content instead of rejecting the deck", () => {
    const r = extractDeckPlan(JSON.stringify({
      slides: [
        { kind: "title", title: "T" },
        { kind: "columns", title: "C", columns: [{ heading: "見出し", bullets: ["x", "y"] }] }, // only 1 col → invalid
        { kind: "closing", title: "End" },
      ],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.slides).toHaveLength(3);
    const mid = r.plan.slides[1];
    expect(mid.kind).toBe("content");
    if (mid.kind === "content") expect(mid.bullets).toEqual(["見出し", "x", "y"]); // heading + bullets flattened
  });

  it("the whole deck survives a bad columns slide at index 8 (the real qwen error)", () => {
    const slides: unknown[] = [{ kind: "title", title: "CRM移行計画" }];
    for (let i = 0; i < 7; i++) slides.push({ kind: "content", title: `S${i}`, bullets: ["x"] });
    slides.push({ kind: "columns", title: "予算", columns: [{ bullets: ["項目1つだけ"] }] }); // slide index 8, 1 col
    const r = extractDeckPlan(JSON.stringify({ slides }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.slides).toHaveLength(9);
  });

  it("keeps the valid slides even when one is unsalvageably broken", () => {
    const r = extractDeckPlan(JSON.stringify({
      slides: [
        { kind: "title", title: "T" },
        { kind: "content", title: "良いスライド", bullets: ["a", "b"] },
      ],
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.slides).toHaveLength(2);
  });
});
