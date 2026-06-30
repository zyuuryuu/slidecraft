/**
 * host-origin-policy.test.ts — locks the collab host's cross-platform admission policy so it can never
 * regress to per-OS origin hand-patching (the bug that broke packaged Windows). It imports the SAME
 * TAURI_WEBVIEW_ORIGINS / DEV_BROWSER_ORIGINS constants the host builds its allowlist from, so adding
 * a new platform origin is a ONE-line change that this test automatically covers — and dropping one
 * fails CI. Encodes the principled model: token = the boundary; Host(421)/Origin(403) = belts.
 */
import { describe, it, expect } from "vitest";
import { checkRequest, TAURI_WEBVIEW_ORIGINS, DEV_BROWSER_ORIGINS, type SecurityConfig } from "../src/mcp/host-security";

const cfg = (): SecurityConfig => ({
  token: "tok",
  allowedOrigins: new Set([...TAURI_WEBVIEW_ORIGINS, ...DEV_BROWSER_ORIGINS]),
  allowedHosts: new Set(["127.0.0.1", "localhost"]),
});
const good = { host: "127.0.0.1:5174", authorization: "Bearer tok" };

describe("collab host admission policy (single source of truth, cross-platform)", () => {
  it("admits EVERY production webview origin incl. Windows http(s)://tauri.localhost (no per-OS regression)", () => {
    for (const origin of [...TAURI_WEBVIEW_ORIGINS, ...DEV_BROWSER_ORIGINS]) {
      expect(checkRequest({ ...good, origin }, cfg())).toBeNull(); // admitted
    }
  });

  it("rejects a cross-origin browser page with 403 (the DNS-rebinding belt)", () => {
    expect(checkRequest({ ...good, origin: "http://evil.com" }, cfg())?.status).toBe(403);
  });

  it("admits an ABSENT Origin (the webview / non-browser client) — the token still gates it", () => {
    expect(checkRequest({ ...good }, cfg())).toBeNull();
  });

  it("Origin is NOT the boundary: an allowed Origin with a WRONG token is rejected by the token (401)", () => {
    const r = checkRequest({ host: "127.0.0.1:5174", origin: "tauri://localhost", authorization: "Bearer wrong" }, cfg());
    expect(r?.status).toBe(401);
  });

  it("the token IS the boundary: no Origin + the right token is admitted (a no-Origin client can't be gated by Origin)", () => {
    expect(checkRequest({ host: "127.0.0.1:5174", authorization: "Bearer tok" }, cfg())).toBeNull();
  });

  it("Host must be loopback: a DNS-rebinding probe carrying a non-loopback Host is 421 before anything else", () => {
    const r = checkRequest({ host: "evil.com:5174", origin: "tauri://localhost", authorization: "Bearer tok" }, cfg());
    expect(r?.status).toBe(421);
  });
});
