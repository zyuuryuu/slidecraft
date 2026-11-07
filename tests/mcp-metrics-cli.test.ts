// mcp-metrics-cli.test.ts — #512: `slidecraft serve --metrics <path>` at the real CLI entry
// (cli.ts → dist/mcp/cli.js). With the flag, a tools/call over stdio appends one JSONL line; without
// it, nothing is written anywhere (the scratch cwd stays empty). Same spawn style as mcp-cli-root.
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliJs = join(root, "dist/mcp/cli.js");
const IT_OPTS = { timeout: 20_000, retry: 2 } as const;

beforeAll(() => {
  execFileSync("npm", ["run", "build:mcp"], { cwd: root, stdio: "pipe" });
  expect(existsSync(cliJs)).toBe(true);
}, 60_000);

/** initialize → initialized → tools/call get_diagram_types; resolve once the id:2 reply arrives.
 *  SLIDECRAFT_HOST_JSON points at a missing file so discovery always lands in solo mode. */
function callOverStdio(args: string[], cwd: string): Promise<{ stderr: string; replied: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliJs, ...args], { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, SLIDECRAFT_HOST_JSON: join(cwd, "no-host.json") } });
    let out = "";
    let stderr = "";
    let settled = false;
    const finish = (replied: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(backstop);
      child.kill();
      resolve({ stderr, replied });
    };
    const backstop = setTimeout(() => finish(false), 15_000);
    child.stderr.on("data", (d) => (stderr += d));
    child.stdout.on("data", (d) => {
      out += d;
      if (out.split("\n").some((l) => l.includes('"id":2'))) finish(true);
    });
    child.on("exit", () => finish(false));
    const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_diagram_types", arguments: {} } });
  });
}

function spawnUntilExit(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliJs, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const backstop = setTimeout(() => child.kill(), 15_000);
    child.on("exit", (code) => {
      clearTimeout(backstop);
      resolve({ code, stderr });
    });
  });
}

describe("slidecraft serve --metrics <path>", () => {
  it("with --metrics: one tools/call → one JSONL line (tool / solo / ok), told on stderr", IT_OPTS, async () => {
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-cli-metrics-"));
    try {
      const path = join(dir, "calls.jsonl");
      const { stderr, replied } = await callOverStdio(["--metrics", path], dir);
      expect(replied).toBe(true);
      expect(stderr).toMatch(/metrics/);
      const lines = readFileSync(path, "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ v: 1, tool: "get_diagram_types", profile: "solo", outcome: "ok", doc: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("without --metrics: the same call writes no file anywhere in the cwd", IT_OPTS, async () => {
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-cli-nometrics-"));
    try {
      const { stderr, replied } = await callOverStdio([], dir);
      expect(replied).toBe(true);
      expect(stderr).not.toMatch(/metrics/);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--metrics with no argument is a usage error (exit 2, never-silent)", IT_OPTS, async () => {
    const { code, stderr } = await spawnUntilExit(["--metrics"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/--metrics/);
  });
});
