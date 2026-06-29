/**
 * host-security.test.ts — the request-admission boundary for the P2 collab listener, plus the
 * handshake-file lifecycle. The bearer token is the real trust boundary (the webview is a
 * no-Origin client); Host/Origin are defense in depth.
 */
import { describe, it, expect, afterEach } from "vitest";
import { statSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mintToken, safeEqual, checkRequest, type SecurityConfig } from "../src/mcp/host-security";
import { writeHostJson, readHostJson, clearHostJson } from "../src/mcp/host-json";

const cfg = (token: string): SecurityConfig => ({
  token,
  allowedOrigins: new Set(["tauri://localhost", "http://localhost:5173"]),
  allowedHosts: new Set(["127.0.0.1", "localhost"]),
});

describe("host-security", () => {
  it("mintToken returns a fresh 256-bit base64url token each call", () => {
    const a = mintToken();
    const b = mintToken();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(Buffer.from(a, "base64url").length).toBe(32);
  });

  it("safeEqual is true only for identical strings (and tolerates length mismatch)", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false); // different length → false, no throw
    expect(safeEqual("", "")).toBe(true);
  });

  it("admits a valid request (loopback host, no Origin, correct token)", () => {
    const t = mintToken();
    expect(checkRequest({ host: "127.0.0.1:5174", authorization: `Bearer ${t}` }, cfg(t))).toBeNull();
  });

  it("the bearer token is the boundary: wrong / missing token → 401", () => {
    const t = mintToken();
    expect(checkRequest({ host: "127.0.0.1", authorization: "Bearer nope" }, cfg(t))?.status).toBe(401);
    expect(checkRequest({ host: "127.0.0.1" }, cfg(t))?.status).toBe(401); // no Authorization
  });

  it("a PRESENT non-allowlisted Origin is refused (403); an ABSENT Origin passes to the token", () => {
    const t = mintToken();
    expect(checkRequest({ host: "127.0.0.1", origin: "http://evil.com", authorization: `Bearer ${t}` }, cfg(t))?.status).toBe(403);
    expect(checkRequest({ host: "127.0.0.1", origin: "tauri://localhost", authorization: `Bearer ${t}` }, cfg(t))).toBeNull();
    // no-Origin (Rust plugin-http / non-browser) with a good token is admitted
    expect(checkRequest({ host: "127.0.0.1", authorization: `Bearer ${t}` }, cfg(t))).toBeNull();
  });

  it("a non-loopback Host is refused (421) before the token is even checked", () => {
    const t = mintToken();
    expect(checkRequest({ host: "10.0.0.5", authorization: `Bearer ${t}` }, cfg(t))?.status).toBe(421);
  });
});

describe("host-json handshake", () => {
  const path = join(tmpdir(), `slidecraft-host-test-${process.pid}.json`);
  afterEach(() => clearHostJson(path));

  it("writes → reads round-trip and clears", () => {
    const data = { url: "http://127.0.0.1:5174/mcp", token: mintToken(), pid: 1234, startedAt: "2026-06-29T00:00:00Z" };
    writeHostJson(path, data);
    expect(readHostJson(path)).toEqual(data);
    clearHostJson(path);
    expect(existsSync(path)).toBe(false);
    expect(readHostJson(path)).toBeNull();
  });

  it("writes the token file 0600 on POSIX (only the OS user can read it)", () => {
    if (process.platform === "win32") return; // ACL hardening is the Rust host's job on Windows
    writeHostJson(path, { url: "u", token: "t", pid: 1, startedAt: "x" });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
