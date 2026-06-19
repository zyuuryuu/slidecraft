/**
 * useHistoryState — undo/redo for a single piece of state (the deck).
 *
 * Every deck mutation (drag/resize a node, edit a slide field, apply AI) routes
 * through `set`, so undo/redo covers BOTH human and AI edits uniformly.
 *
 * Modes:
 *  - "commit"   : push a discrete undo step (default — AI applies, file actions).
 *  - "coalesce" : merge rapid edits within `coalesceMs` into one step (typing).
 *  - "silent"   : update without touching history (deck re-derived from text,
 *                 where the Markdown editor owns its own text undo).
 * `reset(next)` clears the stacks (a brand-new deck).
 */

import { useReducer, useCallback } from "react";

export type HistoryMode = "commit" | "coalesce" | "silent";

export interface History<T> {
  state: T;
  set: (next: T, mode?: HistoryMode) => void;
  reset: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface HState<T> {
  past: T[];
  present: T;
  future: T[];
  lastTs: number;
}

type HAction<T> =
  | { type: "set"; next: T; mode: HistoryMode; ts: number; coalesceMs: number }
  | { type: "reset"; next: T }
  | { type: "undo" }
  | { type: "redo" };

function reducer<T>(s: HState<T>, a: HAction<T>): HState<T> {
  switch (a.type) {
    case "set": {
      if (a.mode === "silent") return { ...s, present: a.next };
      const coalesce =
        a.mode === "coalesce" && a.ts - s.lastTs < a.coalesceMs && s.past.length > 0;
      const past = coalesce ? s.past : [...s.past, s.present].slice(-200);
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

export function useHistoryState<T>(initial: T, coalesceMs = 600): History<T> {
  const [s, dispatch] = useReducer(
    reducer as (s: HState<T>, a: HAction<T>) => HState<T>,
    { past: [], present: initial, future: [], lastTs: 0 },
  );

  const set = useCallback(
    (next: T, mode: HistoryMode = "commit") =>
      dispatch({ type: "set", next, mode, ts: Date.now(), coalesceMs }),
    [coalesceMs],
  );
  const reset = useCallback((next: T) => dispatch({ type: "reset", next }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  return {
    state: s.present,
    set,
    reset,
    undo,
    redo,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
  };
}
