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
});

function spawnCli(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliJs, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => resolve({ code, stderr }));
    // A valid run never exits on its own (it waits on stdio) — kill it once it has had time to
    // report readiness, so this test doesn't hang.
    setTimeout(() => child.kill(), 1500);
  });
}

describe("slidecraft serve --root <dir>", () => {
  it("rejects a missing directory with a non-zero exit and a never-silent stderr message", async () => {
    const { code, stderr } = await spawnCli(["--root", join(tmpdir(), "slidecraft-cli-root-does-not-exist")]);
    expect(code).not.toBe(0);
    expect(code).not.toBeNull();
    expect(stderr).toMatch(/見つかりません/);
  });

  it("rejects --root given a plain file instead of a directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-cli-root-"));
    const filePath = join(dir, "not-a-dir.txt");
    writeFileSync(filePath, "x");
    try {
      const { code, stderr } = await spawnCli(["--root", filePath]);
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/ディレクトリを指定/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects --root with no argument (usage error, not a silent no-op)", async () => {
    const { code, stderr } = await spawnCli(["--root"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/ディレクトリパスが必要/);
  });

  it("starts in scoped-fs mode for a valid directory (reports it on stderr, no crash)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-cli-root-"));
    try {
      const { stderr } = await spawnCli(["--root", dir]);
      expect(stderr).toMatch(/scoped fs/);
      expect(stderr).not.toMatch(/fatal/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no --root still starts in the default --no-fs / base64 mode (non-regression)", async () => {
    const { stderr } = await spawnCli([]);
    expect(stderr).toMatch(/--no-fs \/ base64/);
  });
});
