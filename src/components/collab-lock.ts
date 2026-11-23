/**
 * collab-lock.ts — #727 (ADR-0040 D1): THE derivation of the GUI's collaboration edit lock. The collab host is
 * always on while the GUI runs, so "the host is running" (status connected) must NOT lock anything: the GUI
 * edits as if there were no host until an ALLOWED AI client makes its first tool call (the host's aiActive).
 * App.tsx reads only this (one place — the ref-gated handlers and disabled buttons all follow it).
 */
import type { CollabStatus } from "../ipc/collab-projection";

export function collabEditLocked(s: { status: CollabStatus; aiActive: boolean }): boolean {
  return s.status === "connected" && s.aiActive;
}
