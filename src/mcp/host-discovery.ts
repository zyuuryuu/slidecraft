/**
 * host-discovery.ts — ADR-0033 D2: lets a bare `slidecraft mcp`/`slidecraft serve` invocation
 * (spawned by an external upstream AI, e.g. `claude mcp add`, with no Tauri process around it) find
 * a GUI-hosted collab listener that is ALREADY running, so the client only ever configures ONE MCP
 * entry — it discovers whether to forward or run solo, rather than the human choosing.
 *
 * The path resolved here MUST match what `src-tauri/src/collab.rs:120` writes to
 * (`app.path().app_local_data_dir()` joined with `host.json`) — `tests/host-discovery.test.ts` pins
 * both the app identifier and the Windows Local-vs-Roaming choice against drift.
 */
import { homedir, platform } from "os";
import { join } from "path";
import { readHostJson, type HostHandshake } from "./host-json";

/** Must equal `identifier` in src-tauri/tauri.conf.json — a drift-guard test reads that file and
 *  compares it against this constant directly (JS↔Rust can't share a type, so the test is the seam). */
export const APP_IDENTIFIER = "com.slidecraft.desktop";

/** Mirrors Tauri v2's `app_local_data_dir()` (== the `dirs`/`directories` crate's
 *  `data_local_dir()`): macOS and Linux have no roaming/local split (same dir `appDataDir` would
 *  use); Windows DOES — this is `%LOCALAPPDATA%`, NOT `%APPDATA%` (which is roaming and is what
 *  `app_data_dir()` — a DIFFERENT Tauri API — resolves to). `SLIDECRAFT_HOST_JSON` (the same env
 *  collab.rs sets on the sidecar it spawns) always wins, so tests/dev overrides never fight this. */
export function resolveHostJsonPath(
  env: NodeJS.ProcessEnv = process.env,
  plat: NodeJS.Platform = platform(),
  home: string = homedir(),
): string {
  if (env.SLIDECRAFT_HOST_JSON) return env.SLIDECRAFT_HOST_JSON;
  switch (plat) {
    case "darwin":
      return join(home, "Library", "Application Support", APP_IDENTIFIER, "host.json");
    case "win32":
      return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), APP_IDENTIFIER, "host.json");
    default:
      return join(env.XDG_DATA_HOME || join(home, ".local", "share"), APP_IDENTIFIER, "host.json");
  }
}

export interface DiscoverOptions {
  /** ms to wait for the liveness ping before declaring the entry stale (default 1500). */
  timeoutMs?: number;
  /** override for tests: a fetch-like function instead of the global fetch. */
  fetchImpl?: typeof fetch;
}

/** A live host answers ANY HTTP response (even 400/401 — the token isn't even checked here) within
 *  the timeout; that alone proves the process is up and listening on that port. The actual protocol
 *  handshake (`initialize`) happens later, over the real relay — this is only a liveness probe, not
 *  a second implementation of the MCP handshake. A dead/stale entry times out or the connection is
 *  refused, never hangs past `timeoutMs` — never-silent fallback to solo. */
async function pingAlive(url: string, token: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    void res.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

/** Read `path`'s handshake and confirm it's actually alive. Never-silent: a missing file, corrupt
 *  JSON, or a dead/unreachable process all resolve to null — the caller falls back to solo rather
 *  than hanging or crashing. */
export async function discoverLiveHost(path: string, opts: DiscoverOptions = {}): Promise<HostHandshake | null> {
  const hs = readHostJson(path);
  if (!hs) return null;
  const alive = await pingAlive(hs.url, hs.token, opts.timeoutMs ?? 1500, opts.fetchImpl ?? fetch);
  return alive ? hs : null;
}
