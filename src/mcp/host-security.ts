/**
 * host-security.ts — the request-admission decision for the P2 collab listener (host.ts). Pure
 * logic so it can be unit-tested without a live server. Introducing a localhost listener reverses
 * stdio's no-surface posture, so we harden in DEPTH but the BEARER TOKEN is the real trust
 * boundary: the webview connects through Rust plugin-http with NO Origin header (it is a no-Origin
 * client), so the token — not Origin/CORS — is what gates it. OS-user remains the trust boundary
 * (the token file is 0600 on POSIX — a no-op on Windows, where a real ACL lock-down is deferred;
 * same-user malware is explicitly out of scope, as with stdio).
 */
import { randomBytes, timingSafeEqual } from "crypto";

/** Per-launch 256-bit bearer, base64url. Never persisted beyond the 0600 handshake file. */
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time compare that never early-returns on a length mismatch (does a dummy compare so
 *  timing can't leak the length). The SDK's requireBearerAuth is OAuth-shaped, so we roll our own. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba); // dummy, equal-length compare to keep timing uniform
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export interface SecurityConfig {
  /** the per-launch bearer every request must carry */
  token: string;
  /** Origin allowlist — a PRESENT Origin must be in here; an ABSENT Origin (non-browser / Rust
   *  plugin-http) passes to the token gate. e.g. {"tauri://localhost", "http://localhost:5173"}. */
  allowedOrigins: Set<string>;
  /** loopback host allowlist, e.g. {"127.0.0.1", "localhost"} */
  allowedHosts: Set<string>;
}

export interface AdmissionFailure {
  status: number;
  message: string;
}

/** Admit or reject a request. Returns null to admit, or {status,message} to reject. Order:
 *  (1) Host must be loopback (defense in depth — a non-loopback Host means a misrouted/forged req);
 *  (2) a PRESENT Origin must be allowlisted (DNS-rebinding defense: evil.com→127.0.0.1 still sends
 *      Origin: http://evil.com and is refused); an absent Origin passes;
 *  (3) the bearer token must match — THE trust boundary (stops another local process / a tab that
 *      guessed the port, since loopback alone is not a boundary). */
export function checkRequest(
  headers: { host?: string; origin?: string; authorization?: string },
  cfg: SecurityConfig,
): AdmissionFailure | null {
  const host = (headers.host ?? "").split(":")[0];
  if (host && !cfg.allowedHosts.has(host)) return { status: 421, message: "host not allowed" };
  if (headers.origin !== undefined && !cfg.allowedOrigins.has(headers.origin)) {
    return { status: 403, message: "origin not allowed" };
  }
  const token = (headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !safeEqual(token, cfg.token)) return { status: 401, message: "unauthorized" };
  return null;
}
