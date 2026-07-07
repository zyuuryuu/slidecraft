/**
 * file-open.ts — the desktop glue for the `.scft` OS file-association (double-click a
 * project file → it opens in SlideCraft). Tauri-only; every export no-ops in a plain
 * browser (which has no launch args / native events), so callers never branch on platform.
 *
 * The Rust side (src-tauri/src/file_open.rs) owns the trust boundary: it captures the
 * path the OS handed us (argv on Win/Linux, the Apple open-documents event on macOS),
 * grants THAT single path to the fs scope, and queues it. The webview only ever DRAINS
 * that queue (take_pending_opens) and reads the granted path via the scoped plugin-fs —
 * it never supplies an arbitrary path, so no new arbitrary-read hole is opened.
 */

import { runningInTauri } from "./commands";

/** Drain the paths the OS asked us to open (already fs-scope-granted by Rust). Empty in a browser. */
export async function takePendingOpenPaths(): Promise<string[]> {
  if (!runningInTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string[]>("take_pending_opens");
}

/** Read a launch-handed project path via the scoped plugin-fs (Rust already granted it). */
export async function readProjectFileBytes(path: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  return readFile(path);
}

/** Subscribe to the "OS wants to open a .scft" poke (fired for a warm open — app already
 *  running). Returns an unsubscribe fn. No-op (never fires) in a browser. */
export async function onOpenFileRequested(cb: () => void): Promise<() => void> {
  if (!runningInTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("scft://open-file", () => cb());
}
