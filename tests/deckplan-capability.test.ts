/**
 * deckplan-capability.test.ts — Wave 6 (#11): deckPlanToDeck must respect the TEMPLATE's real
 * capabilities. A generated `table`/`columns`/`diagram` slide for a master that lacks that layout was
 * emitted anyway (the model's kind was trusted blindly). Now, given the catalog, an unsupported kind
 * is DETERMINISTICALLY degraded to content bullets — harness over model, not prompt-only.
 */
import { describe, it, expect } from "vitest";
import { deckPlanToDeck, type DeckPlan } from "../src/engine/deck-plan";
import type { LayoutCatalog } from "../src/engine/template-catalog";

// A minimal catalog that can express ONLY title + content (no table / columns / section / closing).
const contentOnly: LayoutCatalog = [
  { name: "Title.1Title.Single", role: "title", hasTitle: true, bodyCount: 0, placeholders: [] } as unknown as LayoutCatalog[number],
  { name: "Content.1Body.Single", role: "content", hasTitle: true, bodyCount: 1, placeholders: [] } as unknown as LayoutCatalog[number],
];

const tablePlan: DeckPlan = { slides: [{ kind: "table", title: "価格", headers: ["項目", "値"], rows: [["A", "100円"], ["B", "200円"]] }] } as DeckPlan;
const colsPlan: DeckPlan = { slides: [{ kind: "columns", title: "比較", columns: [{ heading: "案X", bullets: ["速い"] }, { heading: "案Y", bullets: ["安い"] }] }] } as DeckPlan;

describe("deckPlanToDeck degrades unsupported kinds when a catalog is given (#11)", () => {
  it("a table on a table-less template becomes content bullets (data kept)", () => {
    const deck = deckPlanToDeck(tablePlan, contentOnly);
    const s = deck.slides[0];
    expect(s.table).toBeUndefined(); // not emitted as a native table
    const txt = JSON.stringify(s);
    expect(txt).toContain("100円"); // the values survive as bullets
    expect(txt).toContain("200円");
  });

  it("columns on a columns-less template become content bullets", () => {
    const deck = deckPlanToDeck(colsPlan, contentOnly);
    const s = deck.slides[0];
    expect(s.placeholders.some((p) => p.idx === "2")).toBe(false); // no second column placeholder
    const txt = JSON.stringify(s);
    expect(txt).toContain("速い");
    expect(txt).toContain("安い");
  });

  it("without a catalog, behavior is unchanged (table stays a native table)", () => {
    const deck = deckPlanToDeck(tablePlan);
    expect(deck.slides[0].table?.rows).toEqual([["項目", "値"], ["A", "100円"], ["B", "200円"]]);
  });
});
