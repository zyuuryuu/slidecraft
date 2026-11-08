/**
 * #517 子 3/4 — what the 協働 panel shows for 接続テスト (the bundled server's own `--doctor`, run by Rust
 * `mcp_doctor`) and for the Claude Desktop `.mcpb` download. Pure view logic; no DOM/Tauri.
 *
 * Locks:
 *  1. doctorView: OK only when the doctor printed its report AND exited 0. Exit 0 with NO report (an older
 *     cli.cjs that does not know --doctor just serves and exits on EOF) is NOT a pass — never a false OK.
 *  2. a failing/timed-out run shows the report it printed plus stderr; spawn / IPC errors carry their reason;
 *     the browser build says the test needs the desktop app.
 *  3. mcpbView: every McpbDownload outcome has its own message; only `available` yields a URL to open.
 *  4. the ipc layer reports `browser` outside Tauri (nothing runs).
 *  5. ja/en both carry every key the views can return.
 */
import { describe, it, expect } from "vitest";
import { doctorView, mcpbView } from "../src/components/collab-diagnostics-view";
import { runMcpDoctor } from "../src/ipc/mcp-doctor";
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";

const ran = (o: Partial<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>) => ({
  kind: "ran" as const, program: "/n/node", args: ["/c/cli.cjs", "--doctor"], exitCode: 0, stdout: "", stderr: "", timedOut: false, ...o,
});
const REPORT = "SlideCraft MCP 接続診断（--doctor）\n  tools/list : OK 38 本\n結果: OK — …\n";

describe("doctorView", () => {
  it("exit 0 with a report → ok, report shown verbatim", () => {
    expect(doctorView(ran({ stdout: REPORT }))).toEqual({ tone: "ok", message: { key: "doctorOk", params: {} }, report: REPORT, stderr: null });
  });
  it("exit 0 but no report → not ok (the installed server does not support --doctor)", () => {
    expect(doctorView(ran({ stdout: "", stderr: "slidecraft mcp: ready (solo stdio, --no-fs / base64)\n" }))).toEqual({
      tone: "ng", message: { key: "doctorNoReport", params: {} }, report: null, stderr: "slidecraft mcp: ready (solo stdio, --no-fs / base64)\n",
    });
  });
  it("non-zero exit → ng with the exit code, the report and stderr", () => {
    expect(doctorView(ran({ exitCode: 1, stdout: REPORT, stderr: "boom\n" }))).toEqual({
      tone: "ng", message: { key: "doctorNg", params: { code: "1" } }, report: REPORT, stderr: "boom\n",
    });
  });
  it("timed out → ng, says so", () => {
    expect(doctorView(ran({ exitCode: null, timedOut: true }))).toMatchObject({ tone: "ng", message: { key: "doctorTimedOut" } });
  });
  it("spawn failure / IPC error / browser → unavailable with the reason", () => {
    expect(doctorView({ kind: "spawnFailed", program: "/n/node", args: [], error: "No such file" })).toEqual({
      tone: "unavailable", message: { key: "doctorSpawnFailed", params: { error: "No such file" } }, report: null, stderr: null,
    });
    expect(doctorView({ kind: "error", error: "ipc down" })).toMatchObject({ tone: "unavailable", message: { key: "doctorIpcError", params: { error: "ipc down" } } });
    expect(doctorView({ kind: "browser" })).toMatchObject({ tone: "unavailable", message: { key: "doctorBrowser" } });
  });
});

describe("mcpbView", () => {
  it("one message per outcome; only `available` opens a URL", () => {
    expect(mcpbView(null)).toEqual({ message: { key: "mcpbLoading", params: {} }, url: null });
    expect(mcpbView({ kind: "browser" })).toEqual({ message: { key: "mcpbBrowser", params: {} }, url: null });
    expect(mcpbView({ kind: "available", tag: "v0.6.0", name: "slidecraft-win32-x64.mcpb", url: "https://github.com/zyuuryuu/slidecraft/releases/download/v0.6.0/slidecraft-win32-x64.mcpb" })).toEqual({
      message: { key: "mcpbDownload", params: { tag: "v0.6.0", name: "slidecraft-win32-x64.mcpb" } },
      url: "https://github.com/zyuuryuu/slidecraft/releases/download/v0.6.0/slidecraft-win32-x64.mcpb",
    });
    expect(mcpbView({ kind: "missing", tag: "v0.5.1", name: "slidecraft-win32-x64.mcpb" })).toEqual({ message: { key: "mcpbMissing", params: { tag: "v0.5.1", name: "slidecraft-win32-x64.mcpb" } }, url: null });
    expect(mcpbView({ kind: "unsupported" })).toEqual({ message: { key: "mcpbUnsupported", params: {} }, url: null });
    expect(mcpbView({ kind: "error", error: "HTTP 503" })).toEqual({ message: { key: "mcpbError", params: { error: "HTTP 503" } }, url: null });
  });
});

describe("ipc", () => {
  it("runMcpDoctor reports `browser` outside Tauri", async () => {
    await expect(runMcpDoctor()).resolves.toEqual({ kind: "browser" });
  });
});

describe("i18n", () => {
  const keys = [
    "doctorButton", "doctorRunning", "doctorOk", "doctorNoReport", "doctorNg", "doctorTimedOut", "doctorSpawnFailed", "doctorIpcError", "doctorBrowser",
    "mcpbLabel", "mcpbLoading", "mcpbBrowser", "mcpbDownload", "mcpbMissing", "mcpbUnsupported", "mcpbError", "mcpbOpenFailed",
  ];
  it.each(keys)("ja and en both define collabPanel.%s", (k) => {
    expect(typeof (ja.collabPanel as Record<string, unknown>)[k]).toBe("string");
    expect(typeof (en.collabPanel as Record<string, unknown>)[k]).toBe("string");
  });
});
