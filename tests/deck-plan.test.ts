/**
 * deck-plan.test.ts — Tests for the DeckPlan → SlideIR harness.
 *
 * DeckPlan is the small, intent-level structure a (possibly weak) model emits;
 * the engine deterministically turns it into correct layouts + placeholders, so
 * the model never has to know the Markdown DSL or layout names.
 */

import { describe, it, expect } from "vitest";
import {
  deckPlanToDeck,
  parseDeckPlan,
  extractDeckPlan,
  type DeckPlan,
} from "../src/engine/deck-plan";
import { serializeMd } from "../src/engine/md-serializer";
import { parseMd } from "../src/engine/md-parser";

describe("deckPlanToDeck", () => {
  it("builds a title slide with fields (idx 0/1/10/11/12)", () => {
    const deck = deckPlanToDeck({
      slides: [{ kind: "title", title: "T", subtitle: "S", category: "C", date: "D", footer: "F" }],
    });
    const s = deck.slides[0];
    expect(s.layout).toBe("Title.1Title.Single");
    expect(s.placeholders.map((p) => p.idx)).toEqual(
      expect.arrayContaining(["0", "1", "10", "11", "12"]),
    );
    expect(s.placeholders.find((p) => p.idx === "0")?.paragraphs[0].segments[0].text).toBe("T");
  });

  it("builds a content slide: subtitle → idx16, bullets → idx1", () => {
    const deck = deckPlanToDeck({
      slides: [{ kind: "content", title: "Title", subtitle: "Sub", bullets: ["a", "b"] }],
    });
    const s = deck.slides[0];
    expect(s.layout).toBe("Content.1Body.Single");
    expect(s.placeholders.find((p) => p.idx === "16")?.paragraphs[0].segments[0].text).toBe("Sub");
    const body = s.placeholders.find((p) => p.idx === "1");
    expect(body?.paragraphs).toHaveLength(2);
    expect(body?.paragraphs[0].bullet).toBe(true);
    expect(body?.paragraphs[0].segments[0].text).toBe("a");
  });

  it("builds a 2-column slide with bold headings", () => {
    const deck = deckPlanToDeck({
      slides: [{
        kind: "columns",
        title: "Cmp",
        columns: [{ heading: "A", bullets: ["a1"] }, { heading: "B", bullets: ["b1"] }],
      }],
    });
    const s = deck.slides[0];
    expect(s.layout).toBe("Column.2Body.Equal");
    const left = s.placeholders.find((p) => p.idx === "1");
    expect(left?.paragraphs[0].segments[0]).toEqual({ text: "A", bold: true });
    expect(left?.paragraphs[1].bullet).toBe(true);
  });

  it("uses the 3-column layout for three columns", () => {
    const deck = deckPlanToDeck({
      slides: [{
        kind: "columns",
        title: "x",
        columns: [{ bullets: ["1"] }, { bullets: ["2"] }, { bullets: ["3"] }],
      }],
    });
    expect(deck.slides[0].layout).toBe("Column.3Body.Equal");
    expect(deck.slides[0].placeholders.map((p) => p.idx)).toEqual(
      expect.arrayContaining(["1", "2", "3"]),
    );
  });

  it("round-trips through Markdown (serialize → parse keeps slides + content subtitle)", () => {
    const plan: DeckPlan = {
      slides: [
        { kind: "title", title: "Report", subtitle: "Q1" },
        { kind: "content", title: "Status", subtitle: "Now", bullets: ["x", "y"] },
        { kind: "closing", title: "Thanks" },
      ],
    };
    const md = serializeMd(deckPlanToDeck(plan));
    const reparsed = parseMd(md);
    expect(reparsed.slides).toHaveLength(3);
    expect(reparsed.slides[1].placeholders.some((p) => p.idx === "16")).toBe(true);
  });

  it("parseDeckPlan accepts valid and rejects invalid plans", () => {
    expect(parseDeckPlan({ slides: [{ kind: "content", title: "ok" }] }).ok).toBe(true);
    expect(parseDeckPlan({ slides: [{ kind: "bogus", title: "x" }] }).ok).toBe(false);
    expect(parseDeckPlan({}).ok).toBe(false);
  });

  it("extractDeckPlan tolerates code fences and surrounding prose", () => {
    const fenced = "Here is the deck:\n```json\n{\"slides\":[{\"kind\":\"closing\",\"title\":\"Bye\"}]}\n```\nDone.";
    const r = extractDeckPlan(fenced);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.slides[0]).toMatchObject({ kind: "closing", title: "Bye" });

    const bare = 'prose before {"slides":[{"kind":"section","title":"S"}]} prose after';
    expect(extractDeckPlan(bare).ok).toBe(true);

    expect(extractDeckPlan("no json here").ok).toBe(false);
    expect(extractDeckPlan("{ not valid json }").ok).toBe(false);
  });

  it("salvages common weak-model mistakes (bare array, kind synonyms, string bullets, missing kind)", () => {
    // bare array instead of { slides: [...] }
    expect(extractDeckPlan('[{"kind":"closing","title":"Bye"}]').ok).toBe(true);

    // bullets as a newline string → split into bullets
    const r1 = extractDeckPlan(JSON.stringify({
      slides: [{ kind: "content", title: "T", bullets: "a\nb\nc" }],
    }));
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      const body = deckPlanToDeck(r1.plan).slides[0].placeholders.find((p) => p.idx === "1");
      expect(body?.paragraphs).toHaveLength(3);
    }

    // kind synonym ("Cover" → title) + missing kind inferred from bullets
    const r2 = extractDeckPlan(JSON.stringify({
      slides: [
        { kind: "Cover", title: "X", subtitle: "y" },
        { title: "Z", bullets: ["1"] },
      ],
    }));
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.plan.slides[0].kind).toBe("title");
      expect(r2.plan.slides[1].kind).toBe("content");
    }

    // columns with bullets given as strings
    const r3 = extractDeckPlan(JSON.stringify({
      slides: [{ kind: "comparison", title: "C", columns: [
        { heading: "A", bullets: "a1\na2" },
        { heading: "B", bullets: "b1" },
      ] }],
    }));
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.plan.slides[0].kind).toBe("columns");
  });
});
