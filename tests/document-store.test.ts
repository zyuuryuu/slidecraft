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

  it("opening a project (deck wrapped into a fresh-history new doc) preserves the current one", () => {
    let s = documentReducer(one(), setDeck(deck(3), "commit")); // current doc a → deck3 (+1 undo step)
    const opened = makeDoc({ id: "b", title: "proj", history: { past: [], present: deck(7), future: [], lastTs: 0 }, mdText: "MD" });
    s = documentReducer(s, { type: "newDoc", doc: opened, activate: true });
    expect(s.activeId).toBe("b");
    expect(byId(s, "b").history.present).toEqual(deck(7));
    expect(byId(s, "b").title).toBe("proj");
    // the previously open project is fully intact, including its own undo history
    expect(byId(s, "a").history.present).toEqual(deck(3));
    expect(byId(s, "a").history.past.length).toBe(1);
  });

  it("newDoc with activate:false opens a BACKGROUND tab (collab mode b — no view switch)", () => {
    let s = one();
    s = documentReducer(s, { type: "newDoc", doc: makeDoc({ id: "b", title: "AI", hostDocId: "H-B" }), activate: false });
    expect(s.docs.map((d) => d.id)).toEqual(["a", "b"]); // tab added…
    expect(s.activeId).toBe("a"); // …but the active view did NOT switch
    expect(byId(s, "b").hostDocId).toBe("H-B");
  });

  it("patchDoc links a SPECIFIC (non-active) tab to a host doc — race-free", () => {
    let s: Store = { docs: [makeDoc({ id: "a" }), makeDoc({ id: "b" })], activeId: "b" };
    s = documentReducer(s, { type: "patchDoc", id: "a", patch: { hostDocId: "SEED" } });
    expect(byId(s, "a").hostDocId).toBe("SEED"); // the seed tab is linked…
    expect(byId(s, "b").hostDocId).toBeUndefined(); // …not the active one
    expect(s.activeId).toBe("b");
  });

  it("initSnapshot (Initialize snapshot) is per-doc — switching docs never leaks doc A's snapshot into doc B (#160)", () => {
    // doc A opens Initialize: snapshot = its own deck.
    let s = documentReducer(one(), setDeck(deck(1), "commit")); // doc a → deck1
    s = documentReducer(s, { type: "patchActiveFn", fn: () => ({ subMode: "import", initSnapshot: deck(1) }) });
    expect(byId(s, "a").initSnapshot).toEqual(deck(1));

    // A file-open activates doc B in the background, then switches to it (repro step 2).
    s = documentReducer(s, {
      type: "newDoc",
      doc: makeDoc({ id: "b", history: { past: [], present: deck(2), future: [], lastTs: 0 } }),
      activate: true,
    });
    expect(byId(s, "b").initSnapshot ?? null).toBeNull(); // doc B starts with NO snapshot of its own

    // doc B enters Initialize too: its OWN snapshot, independent of A's.
    s = documentReducer(s, { type: "patchActiveFn", fn: () => ({ subMode: "import", initSnapshot: deck(2) }) });
    expect(byId(s, "b").initSnapshot).toEqual(deck(2));

    // Switch back to A (still "import", still frozen from step 1) — A's snapshot must be UNCHANGED
    // by anything that happened to B (this is exactly the cross-doc leak #160 reports).
    s = documentReducer(s, { type: "switchDoc", id: "a" });
    expect(byId(s, "a").subMode).toBe("import");
    expect(byId(s, "a").initSnapshot).toEqual(deck(1)); // NOT deck(2)
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
