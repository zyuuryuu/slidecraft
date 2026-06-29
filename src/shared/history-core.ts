/**
 * history-core.ts — the pure undo/redo reducer, lifted out of useHistoryState so it can be
 * shared by the React GUI (useHistoryState / useDocumentStore) AND the headless MCP host
 * (src/mcp) WITHOUT pulling React or DOM. This module imports NOTHING — that purity is what
 * lets Node-side engine/session code give EACH document its own server-side history (R2).
 *
 * Modes:
 *  - "commit"   : push a discrete undo step (AI applies, file actions).
 *  - "coalesce" : merge rapid edits within `coalesceMs` into one step (typing).
 *  - "silent"   : update without touching history (deck re-derived from text).
 * `reset(next)` clears the stacks (a brand-new deck).
 */

export type HistoryMode = "commit" | "coalesce" | "silent";

export interface HState<T> {
  past: T[];
  present: T;
  future: T[];
  lastTs: number;
}

export type HAction<T> =
  | { type: "set"; next: T; mode: HistoryMode; ts: number; coalesceMs: number }
  | { type: "reset"; next: T }
  | { type: "undo" }
  | { type: "redo" };

/** Max retained undo steps; older steps are dropped (slice(-HISTORY_LIMIT)). */
export const HISTORY_LIMIT = 200;

/** Pure undo/redo reducer — gives EACH document (a GUI tab or a sidecar DocEntry) its own
 *  history without duplicating the silent/coalesce/commit/reset/undo/redo semantics. */
export function historyReducer<T>(s: HState<T>, a: HAction<T>): HState<T> {
  switch (a.type) {
    case "set": {
      if (a.mode === "silent") return { ...s, present: a.next };
      const coalesce =
        a.mode === "coalesce" && a.ts - s.lastTs < a.coalesceMs && s.past.length > 0;
      const past = coalesce ? s.past : [...s.past, s.present].slice(-HISTORY_LIMIT);
      return { past, present: a.next, future: [], lastTs: a.ts };
    }
    case "reset":
      return { past: [], present: a.next, future: [], lastTs: 0 };
    case "undo": {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      return { past: s.past.slice(0, -1), present: prev, future: [...s.future, s.present], lastTs: 0 };
    }
    case "redo": {
      if (s.future.length === 0) return s;
      const next = s.future[s.future.length - 1];
      return { past: [...s.past, s.present], present: next, future: s.future.slice(0, -1), lastTs: 0 };
    }
  }
}
