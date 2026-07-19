/**
 * host-discovery.test.ts — ADR-0033 D2: the adaptive front's discovery step. Proves the resolved
 * host.json path matches every platform branch `src-tauri/src/collab.rs:120` can produce (a JS↔Rust
 * drift guard, since the two sides share no type), and that `discoverLiveHost` never hangs or throws
 * on a missing/stale entry — it always resolves to null so the caller falls back to solo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, join } from "path";
import { createServer } from "http";
import { writeHostJson } from "../src/mcp/host-json";
import { APP_IDENTIFIER, resolveHostJsonPath, discoverLiveHost } from "../src/mcp/host-discovery";
import { createCollabHost, type CollabHost } from "../src/mcp/host";

describe("resolveHostJsonPath — JS↔Rust drift guard", () => {
  it("APP_IDENTIFIER matches tauri.conf.json's identifier (collab.rs mints host.json under this app's data dir)", () => {
    const conf = JSON.parse(readFileSync(resolve(__dirname, "../src-tauri/tauri.conf.json"), "utf8")) as { identifier: string };
    expect(APP_IDENTIFIER).toBe(conf.identifier);
  });

  it("collab.rs resolves the app-LOCAL data dir (not roaming) — the Windows Local-vs-Roaming split this module must mirror", () => {
    const rs = readFileSync(resolve(__dirname, "../src-tauri/src/collab.rs"), "utf8");
    expect(rs).toContain("app_local_data_dir()");
    expect(rs).not.toMatch(/\.app_data_dir\(\)/); // a DIFFERENT Tauri API — roaming on Windows, would drift
    expect(rs).toMatch(/data_dir\.join\(["']host\.json["']\)/);
  });

  it("SLIDECRAFT_HOST_JSON always wins, on every platform branch", () => {
    for (const plat of ["darwin", "win32", "linux"] as const) {
      expect(resolveHostJsonPath({ SLIDECRAFT_HOST_JSON: "/tmp/x/host.json" }, plat, "/home/u")).toBe("/tmp/x/host.json");
    }
  });

  it("darwin: ~/Library/Application Support/<identifier>/host.json", () => {
    expect(resolveHostJsonPath({}, "darwin", "/Users/u")).toBe(
      join("/Users/u", "Library", "Application Support", APP_IDENTIFIER, "host.json"),
    );
  });

  it("win32: %LOCALAPPDATA%\\<identifier>\\host.json — LOCAL, not roaming %APPDATA%", () => {
    expect(resolveHostJsonPath({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32", "C:\\Users\\u")).toBe(
      join("C:\\Users\\u\\AppData\\Local", APP_IDENTIFIER, "host.json"),
    );
    // falls back to home\AppData\Local when LOCALAPPDATA is unset (never crashes)
    expect(resolveHostJsonPath({}, "win32", "C:\\Users\\u")).toBe(join("C:\\Users\\u", "AppData", "Local", APP_IDENTIFIER, "host.json"));
  });

  it("linux: $XDG_DATA_HOME/<identifier>/host.json, falling back to ~/.local/share", () => {
    expect(resolveHostJsonPath({ XDG_DATA_HOME: "/home/u/.data" }, "linux", "/home/u")).toBe(join("/home/u/.data", APP_IDENTIFIER, "host.json"));
    expect(resolveHostJsonPath({}, "linux", "/home/u")).toBe(join("/home/u", ".local", "share", APP_IDENTIFIER, "host.json"));
  });
});

describe("discoverLiveHost — never-silent liveness, never hangs", () => {
  it("no file at all → null", async () => {
    const p = join("/tmp", `slidecraft-host-discovery-missing-${process.pid}-${Date.now()}.json`);
    expect(await discoverLiveHost(p, { timeoutMs: 300 })).toBeNull();
  });

  it("stale entry (nothing listening on the recorded port) → null, bounded wall-clock (no hang)", async () => {
    // Bind then immediately close a server to get a port nothing is listening on anymore.
    const probe = createServer();
    const port: number = await new Promise((res) => probe.listen(0, "127.0.0.1", () => res((probe.address() as { port: number }).port)));
    await new Promise<void>((res) => probe.close(() => res()));

    const path = join("/tmp", `slidecraft-host-discovery-stale-${process.pid}-${Date.now()}.json`);
    writeHostJson(path, { url: `http://127.0.0.1:${port}/mcp`, token: "dead-token", pid: 999999, startedAt: new Date(0).toISOString() });

    const start = Date.now();
    const result = await discoverLiveHost(path, { timeoutMs: 800 });
    expect(result).toBeNull();
    expect(Date.now() - start).toBeLessThan(3000); // proves it didn't hang past the timeout
  });

  it("live host → the handshake round-trips back (any response — even 401 — proves liveness)", async () => {
    let host: CollabHost | undefined;
    try {
      host = await createCollabHost({ port: 0, hostJsonPath: null });
      const path = join("/tmp", `slidecraft-host-discovery-live-${process.pid}-${Date.now()}.json`);
      writeHostJson(path, { url: host.url, token: host.token, pid: process.pid, startedAt: new Date().toISOString() });
      const found = await discoverLiveHost(path, { timeoutMs: 1500 });
      expect(found).toEqual({ url: host.url, token: host.token, pid: process.pid, startedAt: expect.any(String) });
    } finally {
      await host?.close();
    }
  });

  it("corrupt JSON → null (never throws)", async () => {
    const path = join("/tmp", `slidecraft-host-discovery-corrupt-${process.pid}-${Date.now()}.json`);
    const { writeFileSync } = await import("fs");
    writeFileSync(path, "{not json");
    expect(await discoverLiveHost(path, { timeoutMs: 300 })).toBeNull();
  });
});
