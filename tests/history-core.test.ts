/**
 * history-core.test.ts — the pure undo/redo reducer lifted to src/shared/history-core.ts so
 * the GUI and the headless MCP host share ONE history primitive. First direct coverage of the
 * reducer (previously only exercised transitively via documentReducer in document-store.test.ts).
 */
import { describe, it, expect } from "vitest";
import { historyReducer, HISTORY_LIMIT, type HState, type HistoryMode } from "../src/shared/history-core";

function seed<T>(present: T): HState<T> {
  return { past: [], present, future: [], lastTs: 0 };
}
function set<T>(s: HState<T>, next: T, mode: HistoryMode = "commit", ts = 1000, coalesceMs = 600): HState<T> {
  return historyReducer(s, { type: "set", next, mode, ts, coalesceMs });
}

describe("history-core reducer", () => {
  it("commit pushes a discrete undo step and clears future", () => {
    let s = seed("a");
    s = set(s, "b", "commit", 100);
    expect(s.present).toBe("b");
    expect(s.past).toEqual(["a"]);
    expect(s.future).toEqual([]);
  });

  it("coalesce merges rapid edits within the window into one step", () => {
    let s = seed("a");
    s = set(s, "b", "commit", 100); // past=["a"], lastTs=100
    s = set(s, "b2", "coalesce", 200, 600); // 100ms < 600 → merge, past unchanged
    expect(s.present).toBe("b2");
    expect(s.past).toEqual(["a"]);
  });

  it("coalesce outside the window pushes a new step", () => {
    let s = seed("a");
    s = set(s, "b", "commit", 100);
    s = set(s, "c", "coalesce", 1000, 600); // 900ms > 600 → push
    expect(s.past).toEqual(["a", "b"]);
  });

  it("silent updates present without touching history", () => {
    let s = seed("a");
    s = set(s, "b", "commit", 100);
    const before = s;
    s = set(s, "c", "silent", 200);
    expect(s.present).toBe("c");
    expect(s.past).toEqual(before.past);
    expect(s.future).toEqual(before.future);
  });

  it("reset clears both stacks", () => {
    let s = seed("a");
    s = set(s, "b", "commit", 100);
    s = historyReducer(s, { type: "reset", next: "z" });
    expect(s).toEqual({ past: [], present: "z", future: [], lastTs: 0 });
  });

  it("undo/redo round-trips", () => {
    let s = seed("a");
    s = set(s, "b", "commit", 100);
    s = set(s, "c", "commit", 200); // past=["a","b"], present="c"
    s = historyReducer(s, { type: "undo" });
    expect(s.present).toBe("b");
    expect(s.future).toEqual(["c"]);
    s = historyReducer(s, { type: "redo" });
    expect(s.present).toBe("c");
    expect(s.future).toEqual([]);
  });

  it("a set after undo clears the redo branch", () => {
    let s = seed("a");
    s = set(s, "b", "commit", 100);
    s = historyReducer(s, { type: "undo" }); // present="a", future=["b"]
    s = set(s, "c", "commit", 300);
    expect(s.future).toEqual([]);
    expect(s.present).toBe("c");
  });

  it("undo on empty past and redo on empty future are no-ops", () => {
    const s = seed("a");
    expect(historyReducer(s, { type: "undo" })).toBe(s);
    expect(historyReducer(s, { type: "redo" })).toBe(s);
  });

  it("caps retained steps at HISTORY_LIMIT (oldest dropped)", () => {
    let s = seed(0);
    for (let i = 1; i <= HISTORY_LIMIT + 50; i++) s = set(s, i, "commit", i);
    expect(s.past.length).toBe(HISTORY_LIMIT);
    expect(s.present).toBe(HISTORY_LIMIT + 50);
    expect(s.past[0]).toBe(50); // the oldest 50 steps fell off
  });
});
