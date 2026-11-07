/**
 * npm-pinned.test.ts — Issue #495. npm 10.8.x–11.0.x crash with `Cannot read properties of null
 * (reading 'edgesOut')` when they rebuild this repo's dependency tree (`npm install <pkg>`,
 * `npm audit fix`, `npm install --package-lock-only`). `npm ci` is unaffected, so CI is fine; only
 * local lockfile updates are blocked. The fix is one pinned entry point, `npm run npm:pinned -- …`,
 * which runs a known-good npm via npx. This pins that contract:
 *   - the script runs an EXACT npm version (not `latest`: npm 12 dropped node 20, which CI uses),
 *   - that version is in the major that still supports node 20 and is at/above the measured fix,
 *   - the lockfile stays at lockfileVersion 3 (what CI's `npm ci` on node 20 / npm 10.8.2 reads),
 *   - RELEASING.md documents the same script name (docs and code don't drift).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "..");
const readJson = (p: string) => JSON.parse(readFileSync(join(REPO, p), "utf8"));

// Measured on 2026-11-07 (PR body of #495's fix): 10.8.2 / 10.9.9 / 11.0.0 crash, 11.21.2 / 12.2.2 don't.
const MIN_FIXED = [11, 21, 2] as const;
const NODE20_MAJOR = 11; // npm 12.x engines: node ^22.22.2 || ^24.15.0 || >=26 — no node 20.

describe("pinned npm for lockfile updates (Issue #495)", () => {
  const script: string | undefined = readJson("package.json").scripts?.["npm:pinned"];

  it("package.json has an `npm:pinned` script that runs npx with an exact npm version", () => {
    expect(script).toBeDefined();
    expect(script).toMatch(/^npx -y npm@\d+\.\d+\.\d+$/);
  });

  it("the pinned version is >= the measured fix and still supports node 20", () => {
    const [maj, min, pat] = (script ?? "").split("@")[1].split(".").map(Number);
    expect(maj).toBe(NODE20_MAJOR);
    const cmp = maj - MIN_FIXED[0] || min - MIN_FIXED[1] || pat - MIN_FIXED[2];
    expect(cmp).toBeGreaterThanOrEqual(0);
  });

  it("package-lock.json stays at lockfileVersion 3", () => {
    expect(readJson("package-lock.json").lockfileVersion).toBe(3);
  });

  it("RELEASING.md documents the pinned entry point", () => {
    expect(readFileSync(join(REPO, "RELEASING.md"), "utf8")).toContain("npm run npm:pinned --");
  });
});
