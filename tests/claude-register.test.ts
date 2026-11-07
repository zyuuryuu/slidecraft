/**
 * #530 — one-click "Claude Code に登録" (`claude mcp add --scope user`), TS side. Pure pieces, no DOM/Tauri.
 *
 * Locks:
 *  1. agreement (R8): TS `serverArgv` (the copy snippet) == the shared fixture that Rust `server_argv` (the run)
 *     also asserts (tests/fixtures/mcp-server-argv.json) — the copied and the executed registration point at
 *     the same server.
 *  2. the copy snippet is built FROM `serverArgv` + `formatArgv` (byte-identical to buildRegistrationSnippets).
 *  3. the confirm dialog shows the full command line, quoted per OS, with the real `claude` path.
 *  4. outcomeView: exit 0 → ok (no copy); non-zero / timeout / claude missing / spawn error / IPC error → the
 *     reason is shown AND the command is copied instead (never-silent fallback); browser → plain copy.
 *  5. planAction: only a `ready` plan opens the confirm dialog; anything else copies (nothing runs).
 *  6. the ipc layer reports `browser` outside Tauri (no fake plan, nothing executed).
 */
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/mcp-server-argv.json";
import {
  buildRegistrationSnippets,
  formatArgv,
  serverArgv,
  type McpInstallInfo,
} from "../src/components/collab-panel-snippets";
import { formatInvocation, outcomeView, planAction } from "../src/components/claude-register-view";
import { planClaudeRegister, runClaudeRegister } from "../src/ipc/claude-register";

const info = (c: (typeof fixture.cases)[number], os: McpInstallInfo["os"]): McpInstallInfo => ({
  os,
  launcherOnPath: c.launcherOnPath,
  nodePath: c.nodePath,
  cliPath: c.cliPath,
});

describe("serverArgv — agreement with Rust server_argv via the shared fixture (R8)", () => {
  it.each(fixture.cases)("$name", (c) => {
    for (const os of ["windows", "macos", "linux"] as const) {
      expect(serverArgv(info(c, os))).toEqual(c.expected);
    }
  });

  it("no install facts (browser / IPC failure) → the launcher word", () => {
    expect(serverArgv(null)).toEqual(["slidecraft-mcp"]);
  });

  it("the copy snippet is `claude mcp add slidecraft -- ` + formatArgv(serverArgv) on every case/OS", () => {
    for (const c of fixture.cases) {
      for (const os of ["windows", "macos", "linux"] as const) {
        const i = info(c, os);
        expect(buildRegistrationSnippets(i).claudeCode).toBe(`claude mcp add slidecraft -- ${formatArgv(os, serverArgv(i))}`);
      }
    }
  });
});

describe("formatInvocation — the full command shown in the confirm dialog", () => {
  const args = ["mcp", "add", "--scope", "user", "slidecraft", "--", "C:\\Program Files\\SlideCraft\\node.exe", "C:\\Program Files\\SlideCraft\\cli.cjs"];

  it("Windows: the real claude path and every argument, double-quoted only where needed", () => {
    expect(formatInvocation("windows", "C:\\Users\\a b\\AppData\\Roaming\\npm\\claude.cmd", args)).toBe(
      '"C:\\Users\\a b\\AppData\\Roaming\\npm\\claude.cmd" mcp add --scope user slidecraft -- "C:\\Program Files\\SlideCraft\\node.exe" "C:\\Program Files\\SlideCraft\\cli.cjs"',
    );
  });

  it("POSIX launcher form", () => {
    expect(formatInvocation("macos", "/opt/homebrew/bin/claude", ["mcp", "add", "--scope", "user", "slidecraft", "--", "slidecraft-mcp"])).toBe(
      "/opt/homebrew/bin/claude mcp add --scope user slidecraft -- slidecraft-mcp",
    );
  });
});

describe("planAction — only a ready plan can lead to a run", () => {
  it("ready → confirm with the full command", () => {
    const a = planAction({ kind: "ready", program: "/usr/bin/claude", args: ["mcp", "add", "--scope", "user", "slidecraft", "--", "slidecraft-mcp"] }, "linux");
    expect(a).toEqual({ kind: "confirm", command: "/usr/bin/claude mcp add --scope user slidecraft -- slidecraft-mcp" });
  });

  it("claude missing / browser / IPC error → copy (with the outcome view that says why)", () => {
    expect(planAction({ kind: "claudeNotFound", searched: ["/usr/bin"] }, "linux").kind).toBe("copy");
    expect(planAction({ kind: "browser" }, "linux").kind).toBe("copy");
    expect(planAction({ kind: "error", error: "boom" }, "linux").kind).toBe("copy");
  });
});

describe("outcomeView — never-silent result + fallback decision", () => {
  const ran = { kind: "ran" as const, program: "/usr/bin/claude", args: ["mcp"], stdout: "Added", stderr: "", timedOut: false };

  it("exit 0 → ok, no copy fallback, output kept", () => {
    const v = outcomeView({ ...ran, exitCode: 0 });
    expect(v).toMatchObject({ tone: "ok", copyFallback: false, message: { key: "registerRanOk", params: { code: "0" } } });
    expect(v.details).toEqual({ exitCode: "0", stdout: "Added", stderr: "" });
  });

  it("non-zero exit → failed + copy fallback, stderr kept", () => {
    const v = outcomeView({ ...ran, exitCode: 1, stderr: "MCP server slidecraft already exists in user config" });
    expect(v).toMatchObject({ tone: "failed", copyFallback: true, message: { key: "registerRanFailed", params: { code: "1" } } });
    expect(v.details?.stderr).toContain("already exists");
  });

  it("killed by signal (no exit code) → failed, code shown as —", () => {
    expect(outcomeView({ ...ran, exitCode: null }).message).toEqual({ key: "registerRanFailed", params: { code: "—" } });
  });

  it("timeout → failed + copy fallback", () => {
    expect(outcomeView({ ...ran, exitCode: null, timedOut: true })).toMatchObject({ tone: "failed", copyFallback: true, message: { key: "registerTimedOut" } });
  });

  it("claude not found → fallback with the searched dirs", () => {
    const v = outcomeView({ kind: "claudeNotFound", searched: ["/usr/bin", "/opt/homebrew/bin"] });
    expect(v).toEqual({ tone: "fallback", copyFallback: true, message: { key: "registerClaudeNotFound", params: { searched: "/usr/bin, /opt/homebrew/bin" } }, details: null });
  });

  it("spawn failure / IPC error → fallback with the error text", () => {
    expect(outcomeView({ kind: "spawnFailed", program: "claude", args: [], error: "Access is denied." }).message).toEqual({ key: "registerSpawnFailed", params: { error: "Access is denied." } });
    expect(outcomeView({ kind: "error", error: "cli.cjs not found" })).toMatchObject({ tone: "fallback", copyFallback: true, message: { key: "registerIpcError", params: { error: "cli.cjs not found" } } });
  });

  it("browser → plain copy, no reason to show", () => {
    expect(outcomeView({ kind: "browser" })).toEqual({ tone: "fallback", copyFallback: true, message: null, details: null });
  });
});

describe("ipc (dual-mode)", () => {
  it("outside Tauri: plan and run both report `browser` — nothing executes", async () => {
    expect(await planClaudeRegister()).toEqual({ kind: "browser" });
    expect(await runClaudeRegister()).toEqual({ kind: "browser" });
  });
});
