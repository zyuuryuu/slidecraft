/**
 * license-present.test.ts — M4 gate: a first PUBLIC release must ship its license + attribution, and
 * declare the license in package.json. Guards against a regression that drops LICENSE/NOTICE or reverts
 * README to "Private". Static-file presence checks — cheap, but they keep the legal artifacts from
 * silently disappearing before a release.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const root = (p: string) => resolve(__dirname, "..", p);

describe("license & attribution (M4)", () => {
  it("ships the required license/attribution artifacts", () => {
    for (const f of ["LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.md"]) {
      expect(existsSync(root(f)), `${f} is missing`).toBe(true);
    }
  });

  it("LICENSE is Apache-2.0 and package.json declares it", () => {
    expect(readFileSync(root("LICENSE"), "utf8")).toContain("Apache License");
    const pkg = JSON.parse(readFileSync(root("package.json"), "utf8"));
    expect(pkg.license).toBe("Apache-2.0");
  });

  it("README states the license (no longer 'Private')", () => {
    const readme = readFileSync(root("README.md"), "utf8");
    expect(readme).toMatch(/Apache License 2\.0|Apache-2\.0/);
    expect(readme).not.toMatch(/^Private$/m);
  });
});
