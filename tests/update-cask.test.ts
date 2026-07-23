/**
 * update-cask.test.ts — CLI error paths for scripts/update-cask.mjs must exit cleanly, never abort.
 *
 * The download path called `process.exit(1)` from inside the async fetch failure branch; on Windows
 * that aborts Node mid-handle-close ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)",
 * src\win\async.c) instead of a clean exit 1. The script now sets process.exitCode and unwinds. These
 * lock the contract that a failure is a plain exit 1 with a message — no crash, and no cask rewrite.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/update-cask.mjs", import.meta.url));
const CASK = fileURLToPath(new URL("../packaging/homebrew/Casks/slidecraft.rb", import.meta.url));

describe("update-cask CLI error paths (#316-class: exit cleanly, never abort)", () => {
  it("no version arg → usage on stderr, exit 1", () => {
    const r = spawnSync("node", [SCRIPT], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage:");
  });

  it("missing local .dmg path → clean exit 1, no libuv abort, cask untouched", () => {
    const before = readFileSync(CASK, "utf8");
    const r = spawnSync("node", [SCRIPT, "9.9.9", "/nonexistent/SlideCraft_9.9.9_aarch64.dmg"], { encoding: "utf8" });
    expect(r.status).toBe(1); // a libuv abort would surface as a non-1 code (e.g. 134/3221226505)
    expect(r.stderr).toContain("local file not found");
    expect(r.stderr).not.toContain("Assertion failed"); // the Windows crash signature must be gone
    expect(readFileSync(CASK, "utf8")).toBe(before); // aborted before writing the cask
  });
});
