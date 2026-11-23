/**
 * host-handshake.ts — the STDOUT handshake line the collab sidecar (host-main.ts) prints on bind and
 * the Tauri supervisor (src-tauri/src/collab.rs) parses to learn {url,token,guiToken} WITHOUT racing the
 * host.json write. This module owns the string contract so the JS producer and the separately-
 * implemented Rust parser can't silently drift. The Rust side expects exactly: a line starting with
 * READY_PREFIX, followed by a one-line JSON object `{ "url": ..., "token": ..., "guiToken": ... }`.
 * #730: this line is the ONLY carrier of `guiToken` (the GUI-only bearer) — host.json never holds it.
 */
export const READY_PREFIX = "SLIDECRAFT_READY ";

export interface Handshake {
  url: string;
  /** the shared bearer (also in host.json, for AI clients) */
  token: string;
  /** #730: the GUI-only bearer — Rust hands it to the webview; never persisted or logged */
  guiToken: string;
}

/** One tagged, single-line handshake (no trailing newline — the caller adds it). */
export function formatReadyLine(h: Handshake): string {
  return `${READY_PREFIX}${JSON.stringify({ url: h.url, token: h.token, guiToken: h.guiToken })}`;
}

/** Parse a stdout line; null for any non-handshake / malformed / partial line (never-silent: a
 *  missing url, token or guiToken yields null rather than a half-built handshake). */
export function parseReadyLine(line: string): Handshake | null {
  if (!line.startsWith(READY_PREFIX)) return null;
  try {
    const o = JSON.parse(line.slice(READY_PREFIX.length)) as Partial<Handshake>;
    return typeof o.url === "string" && typeof o.token === "string" && typeof o.guiToken === "string"
      ? { url: o.url, token: o.token, guiToken: o.guiToken }
      : null;
  } catch {
    return null;
  }
}
