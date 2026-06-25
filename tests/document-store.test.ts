/**
 * document-store.test.ts — the multi-document core: per-doc history + isolation.
 * The reducer is pure, so we drive it directly (no React).
 */
import { describe, it, expect } from "vitest";
import { documentReducer, makeDoc, type Store } from "../src/components/useDocumentStore";
import type { DeckIR } from "../src/engine/slide-schema";

const deck = (n: number) => ({ slides: Array.from({ length: n }, () => ({})) }) as unknown as DeckIR;
const setDeck = (next: DeckIR | null, mode: "commit" | "silent" | "coalesce", ts = 1) =>
  ({ type: "history", action: { type: "set", next, mode, ts, coalesceMs: 600 } }) as const;
const undo = { type: "history", action: { type: "undo" } } as const;

const one = (): Store => ({ docs: [makeDoc({ id: "a", mdText: "A" })], activeId: "a" });
const byId = (s: Store, id: string) => s.docs.find((d) => d.id === id)!;

describe("documentReducer — history (active doc)", () => {
  it("commit pushes undo steps; undo restores the previous deck", () => {
    let s = one();
    s = documentReducer(s, setDeck(deck(1), "commit"));
    s = documentReducer(s, setDeck(deck(2), "commit"));
    expect(byId(s, "a").history.present).toEqual(deck(2));
    expect(byId(s, "a").history.past.length).toBe(2); // [null, deck1]
    s = documentReducer(s, undo);
    expect(byId(s, "a").history.present).toEqual(deck(1));
  });

  it("silent updates present without touching the undo stack", () => {
    const s = documentReducer(one(), setDeck(deck(1), "silent"));
    expect(byId(s, "a").history.present).toEqual(deck(1));
    expect(byId(s, "a").history.past.length).toBe(0);
  });

  it("coalesce merges rapid edits within the window into one step", () => {
    let s = documentReducer(one(), setDeck(deck(1), "commit", 100));
    s = documentReducer(s, setDeck(deck(2), "coalesce", 200)); // 200-100 < 600 → no new step
    expect(byId(s, "a").history.past.length).toBe(1);
    expect(byId(s, "a").history.present).toEqual(deck(2));
  });
});

describe("documentReducer — per-doc fields", () => {
  it("patchActiveFn updates the active doc by value and by updater", () => {
    let s = documentReducer(one(), { type: "patchActiveFn", fn: () => ({ activeSlide: 3 }) });
    expect(byId(s, "a").activeSlide).toBe(3);
    s = documentReducer(s, { type: "patchActiveFn", fn: (d) => ({ selected: new Set([...d.selected, 5]) }) });
    expect([...byId(s, "a").selected].sort()).toEqual([0, 5]);
  });
});

describe("documentReducer — document collection + ISOLATION", () => {
  it("newDoc adds + activates, and editing it leaves the other doc untouched", () => {
    let s = documentReducer(one(), setDeck(deck(1), "commit")); // doc a → deck1
    s = documentReducer(s, { type: "newDoc", doc: makeDoc({ id: "b", mdText: "B" }), activate: true });
    expect(s.activeId).toBe("b");
    expect(s.docs.length).toBe(2);
    s = documentReducer(s, setDeck(deck(9), "commit")); // edits ACTIVE (b)
    expect(byId(s, "b").history.present).toEqual(deck(9));
    // the first document is fully preserved — the destroy-in-place bug is gone
    expect(byId(s, "a").history.present).toEqual(deck(1));
    expect(byId(s, "a").mdText).toBe("A");
  });

  it("switchDoc changes the active doc; closeDoc removes it and reactivates a neighbor; the last doc is never closed", () => {
    let s: Store = { docs: [makeDoc({ id: "a" }), makeDoc({ id: "b" }), makeDoc({ id: "c" })], activeId: "c" };
    s = documentReducer(s, { type: "switchDoc", id: "a" });
    expect(s.activeId).toBe("a");
    s = documentReducer(s, { type: "closeDoc", id: "a" });
    expect(s.docs.map((d) => d.id)).toEqual(["b", "c"]);
    expect(s.activeId).toBe("b");
    s = documentReducer(s, { type: "closeDoc", id: "b" });
    expect(s.docs.map((d) => d.id)).toEqual(["c"]);
    s = documentReducer(s, { type: "closeDoc", id: "c" }); // last → no-op
    expect(s.docs.map((d) => d.id)).toEqual(["c"]);
  });
});
