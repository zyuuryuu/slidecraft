/**
 * host-json.ts — the handshake file the collab listener (host.ts) writes after binding, so the
 * GUI/agent can discover the listener's URL + per-launch token. Written 0600 (only the OS user can
 * read the token). Windows ACL hardening is applied by the Rust host (P2.3); on POSIX the
 * mode + chmod is umask-proof. The file is rewritten on every launch (token rotates) and cleared
 * on exit, so a stale file's token is already invalid once a fresh sidecar rebinds.
 */
import { writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "fs";

export interface HostHandshake {
  /** the MCP endpoint, e.g. http://127.0.0.1:5174/mcp */
  url: string;
  /** the per-launch bearer (see host-security.mintToken) */
  token: string;
  /** the sidecar pid (for liveness checks / reaping) */
  pid: number;
  /** ISO timestamp of when the listener bound */
  startedAt: string;
}

export function writeHostJson(path: string, data: HostHandshake): void {
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  if (process.platform !== "win32") {
    try {
      chmodSync(path, 0o600); // umask-proof: force 0600 even if the open() honoured a looser umask
    } catch {
      /* best effort */
    }
  }
}

export function readHostJson(path: string): HostHandshake | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as HostHandshake;
  } catch {
    return null;
  }
}

export function clearHostJson(path: string): void {
  try {
    if (existsSync(path)) rmSync(path);
  } catch {
    /* best effort — a leftover file's token is invalidated on the next rebind anyway */
  }
}
