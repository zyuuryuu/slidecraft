// setup-hooks.mjs — point git's hooksPath at .githooks, cross-platform (npm `prepare`).
//
// Replaces the POSIX-only `git config core.hooksPath .githooks 2>/dev/null || true`, which npm runs
// under cmd.exe on Windows — where `2>/dev/null` is an invalid path and `true` is not a command, so
// `npm install` exits code 1 and the hooks path is never set (Issue #272). Node runs identically on
// Windows / macOS / Linux.
//
// Non-fatal by design: if git is absent or this isn't a git repo (tarball extraction, some CI), the
// command fails and we swallow it — `prepare` must never fail `npm install` (the old `|| true`).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Point git's core.hooksPath at .githooks. Returns true on success, false if git is unavailable or
 * the command failed. Never throws — so the `prepare` lifecycle can't break `npm install`.
 */
export function setupHooks() {
  try {
    // execFile (no shell) — avoids the cmd.exe/POSIX-shell quoting differences that caused #272.
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
    return true;
  } catch {
    return false; // git missing / not a git repo — non-fatal, mirrors the old `|| true`
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) setupHooks();
