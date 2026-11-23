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

/** The webview's PRODUCTION Origin differs by platform (Tauri v2) and can shift across versions:
 *  macOS/Linux = tauri://localhost, Windows (WebView2) = http(s)://tauri.localhost. The webview
 *  reaches the host via Rust plugin-http, which forwards this Origin, so ALL must be admitted or the
 *  packaged app 403s (the Windows http://tauri.localhost gap caused exactly that). This is the ONE
 *  source of truth shared by host.ts AND tests/host-origin-policy.test.ts so the policy can never
 *  regress to per-OS hand-patching again. Rationale: the Origin layer is only a BROWSER DNS-rebinding
 *  belt — the bearer TOKEN is the real boundary — so this list tracks legit webview/dev ORIGINS and
 *  must never be relied on to gate access. */
export const TAURI_WEBVIEW_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"] as const;
/** Browser dev origins we trust (the Vite dev server). */
export const DEV_BROWSER_ORIGINS = ["http://localhost:5173"] as const;

export interface SecurityConfig {
  /** the per-launch SHARED bearer (published in host.json for AI clients) */
  token: string;
  /** #730 (ADR-0040 D3-6 / ADR-0038 D3): the per-launch GUI-ONLY bearer. Minted next to `token`, handed
   *  to the webview ONLY via the stdout READY line (never host.json / logs / argv). Holding it is what
   *  makes a connection the GUI — the self-declared `x-slidecraft-role` header is never a credential. */
  guiToken: string;
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

export type ClientRole = "gui" | "ai";

export interface AdmissionHeaders {
  host?: string;
  origin?: string;
  authorization?: string;
  /** the raw `x-slidecraft-role` header, if any. NOT a credential (#730): only checked so that a
   *  request NAMING a role without the GUI token is refused rather than silently reinterpreted. */
  role?: string;
}

/** Admit or reject a request AND decide its role — the ONE place both are computed (R8). Order:
 *  (1) Host must be loopback (defense in depth — a non-loopback Host means a misrouted/forged req);
 *  (2) a PRESENT Origin must be allowlisted (DNS-rebinding defense: evil.com→127.0.0.1 still sends
 *      Origin: http://evil.com and is refused); an absent Origin passes;
 *  (3) the bearer must be the shared token or the GUI token — THE trust boundary (stops another local
 *      process / a tab that guessed the port, since loopback alone is not a boundary). Both compares
 *      always run (timing-safe, no short-circuit revealing which one matched);
 *  (4) #730: a `x-slidecraft-role` header without the GUI token is refused (403) — claiming the role is
 *      not a way to become the GUI (ADR-0040 D3-6: that would bypass client approval).
 *  The role is "gui" iff the bearer is the GUI token; otherwise "ai". */
export function admitRequest(headers: AdmissionHeaders, cfg: SecurityConfig): { role: ClientRole } | AdmissionFailure {
  const host = (headers.host ?? "").split(":")[0];
  if (host && !cfg.allowedHosts.has(host)) return { status: 421, message: "host not allowed" };
  if (headers.origin !== undefined && !cfg.allowedOrigins.has(headers.origin)) {
    return { status: 403, message: "origin not allowed" };
  }
  const token = (headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  const isShared = safeEqual(token, cfg.token);
  const isGui = safeEqual(token, cfg.guiToken);
  if (!token || (!isShared && !isGui)) return { status: 401, message: "unauthorized" };
  if (headers.role !== undefined && !isGui) return { status: 403, message: "role header requires the gui token" };
  return { role: isGui ? "gui" : "ai" };
}

/** Admission only (null = admit). A view of admitRequest, kept for callers that need no role. */
export function checkRequest(headers: AdmissionHeaders, cfg: SecurityConfig): AdmissionFailure | null {
  const r = admitRequest(headers, cfg);
  return "status" in r ? r : null;
}
