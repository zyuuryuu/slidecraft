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
import { historyReducer, type HState, type HAction, type HistoryMode } from "../shared/history-core";

// The pure reducer + its types now live in src/shared/history-core (React-free, shared with
// the headless MCP host). Re-export them so existing importers of "./useHistoryState" keep working.
export { historyReducer };
export type { HState, HAction, HistoryMode } from "../shared/history-core";

export interface History<T> {
  state: T;
  set: (next: T, mode?: HistoryMode) => void;
  reset: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useHistoryState<T>(initial: T, coalesceMs = 600): History<T> {
  const [s, dispatch] = useReducer(
    historyReducer as (s: HState<T>, a: HAction<T>) => HState<T>,
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
