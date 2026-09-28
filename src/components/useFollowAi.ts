/**
 * useFollowAi.ts — #407 live co-authoring follow: when the connected AI changes slides, jump the view
 * to the first changed slide and briefly flash the changed thumbnails, so the human SEES the deck being
 * built without hunting for the edit. The CollabProjection decides WHEN (AI-origin only, never the
 * human's own edit, not while they're typing, only once the deck at that rev is applied); this hook
 * owns the user setting (on by default, persisted) and the view side (focus + flash).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FollowTarget } from "../ipc/collab-projection";

const KEY = "slidecraft_collab_follow";
const FLASH_MS = 1500;

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function useFollowAi(focusSlide: (index: number) => void) {
  const [enabled, setEnabledState] = useState<boolean>(readEnabled);
  const [flash, setFlash] = useState<ReadonlySet<number> | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  const focusRef = useRef(focusSlide);
  useEffect(() => {
    enabledRef.current = enabled;
    focusRef.current = focusSlide;
  });

  const setEnabled = useCallback((v: boolean) => {
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    setEnabledState(v);
  }, []);

  // Stable identity: useCollab reads it through a ref at event time.
  const onFollow = useCallback((f: FollowTarget) => {
    if (!enabledRef.current || f.indices.length === 0) return;
    focusRef.current(f.indices[0]);
    setFlash(new Set(f.indices));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(undefined), FLASH_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { enabled, setEnabled, flash, onFollow };
}
