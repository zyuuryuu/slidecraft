/**
 * setup-hooks.test.ts — #272: the `prepare` lifecycle script must be cross-platform.
 *
 * The old `prepare` was `git config core.hooksPath .githooks 2>/dev/null || true` — POSIX-shell
 * syntax that npm runs under cmd.exe on Windows, where `2>/dev/null` is an invalid path and `true`
 * is not a command, so `npm install` exits code 1 (and the hooks path is never set). The fix moves
 * it to a Node script (`scripts/setup-hooks.mjs`) that behaves identically on Windows/macOS/Linux.
 *
 * Two invariants are locked here (the issue's acceptance criteria):
 *   1. after it runs, git's core.hooksPath points at .githooks;
 *   2. when git can't run (git absent / not a git repo — tarball extraction, some CI), it is
 *      NON-FATAL: never throws, and the CLI exits 0 — so `prepare` never fails `npm install`
 *      (the original `|| true` intent).
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setupHooks } from "../scripts/setup-hooks.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/setup-hooks.mjs", import.meta.url));

function hooksPath(cwd?: string): string {
  try {
    return execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

describe("setup-hooks (cross-platform prepare — #272)", () => {
  // Idempotent (the repo's hooksPath is already .githooks), but restore whatever was there so the
  // test leaves no trace.
  const original = hooksPath();
  afterEach(() => {
    if (original) execFileSync("git", ["config", "core.hooksPath", original], { stdio: "ignore" });
  });

  it("points git core.hooksPath at .githooks and reports success", () => {
    const ok = setupHooks();
    expect(ok).toBe(true);
    expect(hooksPath()).toBe(".githooks");
  });

  it("is non-fatal when git config fails (non-git dir): never throws, CLI exits 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "slidecraft-hooks-"));
    try {
      // `node scripts/setup-hooks.mjs` in a directory with no git repo above it: `git config
      // core.hooksPath` fails, but the script must swallow it and exit 0. execFileSync throws if the
      // child exits non-zero, so a clean return IS the assertion.
      expect(() => execFileSync("node", [SCRIPT], { cwd: dir, stdio: "ignore" })).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
