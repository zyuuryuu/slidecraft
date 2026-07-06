/**
 * version-sync.test.ts — the CI drift gate for M0 (version single-sourcing). The app version lives in
 * six files (package.json / tauri.conf.json / Cargo.toml / two hardcoded server-client strings / the
 * Homebrew cask); this asserts they all AGREE, so a bump that misses one is caught by `npm test`.
 * Uses scripts/bump-version.mjs's readers (single source of the file list + patterns — no drift here either).
 */
import { describe, it, expect } from "vitest";
import { readAllVersions } from "../scripts/bump-version.mjs";

describe("version single-source (M0)", () => {
  it("every version marker is present (a refactor didn't move/rename a version string)", () => {
    for (const v of readAllVersions()) expect(v.version, `version marker missing in ${v.path}`).not.toBeNull();
  });

  it("all six version markers agree (drift gate)", () => {
    const versions = readAllVersions();
    const unique = [...new Set(versions.map((v) => v.version))];
    expect(unique, `version DRIFT across files: ${JSON.stringify(versions, null, 2)}`).toHaveLength(1);
  });

  it("the version is semver-shaped", () => {
    expect(readAllVersions()[0].version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});
