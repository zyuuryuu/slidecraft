// mcp-cli-root.test.ts — ADR-0035 stage 1 (#299): `slidecraft serve --root <dir>` at the actual
// CLI entry (cli.ts → dist/mcp/cli.js), not just the in-process buildServer wiring covered by
// mcp-scoped-output.test.ts. Spawns the real built CLI over stdio, same harness style as
// mcp-cli-bundle.test.ts's runInitialize.
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliJs = join(root, "dist/mcp/cli.js");

beforeAll(() => {
  execFileSync("npm", ["run", "build:mcp"], { cwd: root, stdio: "pipe" });
  expect(existsSync(cliJs)).toBe(true);
}, 60_000); // npm run build:mcp can exceed the 10s default hook timeout under full-suite load (#320)

// #320: the old helper killed the child after a FIXED 1.5s. Under full-suite parallel load that
// raced both directions — a slow error-path exit got killed first (code null), and a slow valid
// start hadn't printed its mode line yet (stderr miss). The two helpers below wait on the actual
// signal instead of the clock; SPAWN_TIMEOUT_MS is only a backstop against a genuine hang.
const SPAWN_TIMEOUT_MS = 15_000;
const IT_OPTS = { timeout: 20_000, retry: 2 } as const; // retry: same load-spike allowance as #281's real-browser tests

/** Error paths: the CLI exits non-zero on its own — wait for that real exit. If the backstop kill
 *  ever fires, code is null and the asserts reject loudly (never-silent, not a masked pass). */
function spawnCliUntilExit(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliJs, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const backstop = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(backstop);
      resolve({ code, stderr });
    });
  });
}

/** Valid runs: `serve` never exits on its own (it waits on stdio) — resolve as soon as the
 *  accumulated stderr matches the expected readiness line, then kill the child. An unexpected
 *  early exit (crash) also resolves, handing the partial stderr to the asserts. */
function spawnCliUntilStderr(args: string[], ready: RegExp): Promise<{ stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliJs, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(backstop);
      child.kill();
      resolve({ stderr });
    };
    const backstop = setTimeout(finish, SPAWN_TIMEOUT_MS);
    child.stderr.on("data", (d) => {
      stderr += d;
      if (ready.test(stderr)) finish();
    });
    child.on("exit", finish);
  });
}

describe("slidecraft serve --root <dir>", () => {
  it("rejects a missing directory with a non-zero exit and a never-silent stderr message", IT_OPTS, async () => {
    const { code, stderr } = await spawnCliUntilExit(["--root", join(tmpdir(), "slidecraft-cli-root-does-not-exist")]);
    expect(code).not.toBe(0);
    expect(code).not.toBeNull();
    expect(stderr).toMatch(/見つかりません/);
  });

  it("rejects --root given a plain file instead of a directory", IT_OPTS, async () => {
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-cli-root-"));
    const filePath = join(dir, "not-a-dir.txt");
    writeFileSync(filePath, "x");
    try {
      const { code, stderr } = await spawnCliUntilExit(["--root", filePath]);
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/ディレクトリを指定/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects --root with no argument (usage error, not a silent no-op)", IT_OPTS, async () => {
    const { code, stderr } = await spawnCliUntilExit(["--root"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/ディレクトリパスが必要/);
  });

  it("starts in scoped-fs mode for a valid directory (reports it on stderr, no crash)", IT_OPTS, async () => {
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-cli-root-"));
    try {
      const { stderr } = await spawnCliUntilStderr(["--root", dir], /scoped fs/);
      expect(stderr).toMatch(/scoped fs/);
      expect(stderr).not.toMatch(/fatal/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no --root still starts in the default --no-fs / base64 mode (non-regression)", IT_OPTS, async () => {
    const { stderr } = await spawnCliUntilStderr([], /--no-fs \/ base64/);
    expect(stderr).toMatch(/--no-fs \/ base64/);
  });
});
