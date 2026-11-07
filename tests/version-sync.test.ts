/**
 * version-sync.test.ts — the CI drift gate for M0 (version single-sourcing). The app version lives in
 * eight places (package.json / tauri.conf.json / Cargo.toml / Cargo.lock's app crate / three hardcoded
 * server-client strings / the Homebrew cask); this asserts they all AGREE, so a bump that misses one is
 * caught by `npm test`. Uses scripts/bump-version.mjs's readers (single source of the file list + patterns —
 * no drift here either).
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readAllVersions, TARGETS } from "../scripts/bump-version.mjs";

const REPO = join(__dirname, "..");
const LOCK = "src-tauri/Cargo.lock";
const APP_CRATE = "diagram-pipeline-desktop";

describe("version single-source (M0)", () => {
  it("every version marker is present (a refactor didn't move/rename a version string)", () => {
    for (const v of readAllVersions()) expect(v.version, `version marker missing in ${v.path}`).not.toBeNull();
  });

  it("all version markers agree (drift gate)", () => {
    const versions = readAllVersions();
    const unique = [...new Set(versions.map((v) => v.version))];
    expect(unique, `version DRIFT across files: ${JSON.stringify(versions, null, 2)}`).toHaveLength(1);
  });

  it("the version is semver-shaped", () => {
    expect(readAllVersions()[0].version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it("Cargo.lock's app crate is a drift-gate target (Issue #476)", () => {
    expect(TARGETS.map((t: { path: string }) => t.path)).toContain(LOCK);
    const lock = readAllVersions().find((v) => v.path === LOCK);
    const toml = readAllVersions().find((v) => v.path === "src-tauri/Cargo.toml");
    expect(lock?.version).toBe(toml?.version);
  });

  it("the Cargo.lock target names the same crate as Cargo.toml's [package] name", () => {
    const toml = readFileSync(join(REPO, "src-tauri/Cargo.toml"), "utf8");
    expect(toml).toMatch(new RegExp(`\\[package\\]\\s*\\nname = "${APP_CRATE}"\\n`));
  });
});

/**
 * Run the real script (main()) against a fixture tree: copy scripts/bump-version.mjs + every target file
 * into a temp dir. The script resolves ROOT from its own location, so it operates on the copy only.
 */
describe("bump-version.mjs on a fixture tree (Issue #476)", () => {
  let tmp = "";
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  function makeFixture(): string {
    tmp = mkdtempSync(join(tmpdir(), "slidecraft-bump-"));
    const files = ["scripts/bump-version.mjs", ...TARGETS.map((t: { path: string }) => t.path)];
    for (const rel of files) {
      mkdirSync(dirname(join(tmp, rel)), { recursive: true });
      copyFileSync(join(REPO, rel), join(tmp, rel));
    }
    return tmp;
  }
  const run = (root: string, ...args: string[]) =>
    execFileSync(process.execPath, [join(root, "scripts/bump-version.mjs"), ...args], { encoding: "utf8" });

  /** Set the app crate's version in the fixture lock to `v` (only that [[package]] block). */
  function setLockAppVersion(root: string, v: string) {
    const p = join(root, LOCK);
    const text = readFileSync(p, "utf8");
    const re = new RegExp(`(\\[\\[package\\]\\]\\nname = "${APP_CRATE}"\\nversion = ")[^"]*(")`);
    expect(text).toMatch(re);
    writeFileSync(p, text.replace(re, `$1${v}$2`));
  }

  it("--check is RED when Cargo.lock's app crate is left at an old version", () => {
    const root = makeFixture();
    setLockAppVersion(root, "0.0.1");
    let status = 0;
    try {
      run(root, "--check");
    } catch (e) {
      status = (e as { status: number }).status;
    }
    expect(status).toBe(1);
  });

  it("setting a version updates every target, including Cargo.lock's app crate, and --check is green", () => {
    const root = makeFixture();
    run(root, "9.8.7");
    for (const t of TARGETS as { path: string; re: RegExp }[]) {
      const m = readFileSync(join(root, t.path), "utf8").match(t.re);
      expect(m?.[2], t.path).toBe("9.8.7");
    }
    expect(run(root, "--check")).toContain("9.8.7");
  });

  it("only the app crate's version line in Cargo.lock changes (other packages / checksums untouched)", () => {
    const root = makeFixture();
    const before = readFileSync(join(root, LOCK), "utf8").split("\n");
    run(root, "9.8.7");
    const after = readFileSync(join(root, LOCK), "utf8").split("\n");
    expect(after).toHaveLength(before.length);
    const diff = before.flatMap((line, i) => (line === after[i] ? [] : [{ i, line, next: after[i] }]));
    expect(diff).toHaveLength(1);
    expect(before[diff[0].i - 1]).toBe(`name = "${APP_CRATE}"`);
    expect(diff[0].next).toBe('version = "9.8.7"');
  });
});
