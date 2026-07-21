/**
 * verify-cask.test.ts — unit coverage for `caskMatchesSums` (scripts/update-cask.mjs), the pure
 * function `scripts/verify-cask.mjs` uses to fail a release when the Homebrew cask's sha256 has
 * gone stale relative to the published .dmg (Issue #287: `npm run version:set` bumps the cask's
 * `version` but leaves `sha256` untouched, so a version bump alone can silently ship a mismatch —
 * hit for real at v0.4.0). This is the ONLY implementation of "does the cask match?" (R8); the CLI
 * (release.yml wiring) is exercised end-to-end in CI, not here — the dmg only exists there.
 */
import { describe, it, expect } from "vitest";
import { caskMatchesSums, parseCaskShas } from "../scripts/update-cask.mjs";

const ARM_SHA = "e2d27919ad59b26660636a4c34f56b995b2c9d18164b750f1cbc480f5f3e43fe";
const INTEL_SHA = "df4522762b96222e4735d2ad15738139f07ed0072b8cce6d29454b65d2e2825b";
const OTHER_SHA = "0e882e65251a22d6b9b1825e3f2fea2600c9f9a4d218f12541f8dd2ff18764e8";

const armOnlyCask = (sha: string) => `
cask "slidecraft" do
  version "0.4.0"
  sha256 "${sha}"

  url "https://github.com/zyuuryuu/slidecraft/releases/download/v#{version}/SlideCraft_#{version}_aarch64.dmg"
end
`;

const armIntelCask = (arm: string, intel: string) => `
cask "slidecraft" do
  version "0.4.0"

  on_arm do
    sha256 "${arm}"
  end
  on_intel do
    sha256 "${intel}"
  end
end
`;

const sums = (...lines: [string, string][]) => lines.map(([sha, name]) => `${sha}  ${name}`).join("\n") + "\n";

describe("parseCaskShas", () => {
  it("extracts sha256 hex strings in file order", () => {
    expect(parseCaskShas(armOnlyCask(ARM_SHA))).toEqual([ARM_SHA]);
    expect(parseCaskShas(armIntelCask(ARM_SHA, INTEL_SHA))).toEqual([ARM_SHA, INTEL_SHA]);
  });

  it("returns an empty array when there are no sha256 lines", () => {
    expect(parseCaskShas('cask "slidecraft" do\n  version "0.4.0"\nend\n')).toEqual([]);
  });
});

describe("caskMatchesSums", () => {
  it("matches when the cask's sha256 equals the SHA256SUMS entry for that version (arm64-only)", () => {
    const s = sums([ARM_SHA, "SlideCraft_0.4.0_aarch64.dmg"]);
    expect(caskMatchesSums(armOnlyCask(ARM_SHA), s, "0.4.0")).toBe(true);
  });

  it("does NOT match when the cask's sha256 is stale (version bumped, sha256 left behind — the #287 bug)", () => {
    const s = sums([ARM_SHA, "SlideCraft_0.4.0_aarch64.dmg"]);
    expect(caskMatchesSums(armOnlyCask(OTHER_SHA), s, "0.4.0")).toBe(false);
  });

  it("does NOT match when SHA256SUMS has no entry for the requested version", () => {
    const s = sums([ARM_SHA, "SlideCraft_0.3.0_aarch64.dmg"]);
    expect(caskMatchesSums(armOnlyCask(ARM_SHA), s, "0.4.0")).toBe(false);
  });

  it("matches an arm+intel cask only when BOTH sha256 lines agree with SHA256SUMS", () => {
    const s = sums([ARM_SHA, "SlideCraft_0.4.0_aarch64.dmg"], [INTEL_SHA, "SlideCraft_0.4.0_x64.dmg"]);
    expect(caskMatchesSums(armIntelCask(ARM_SHA, INTEL_SHA), s, "0.4.0")).toBe(true);
  });

  it("does NOT match an arm+intel cask when only one arch's sha256 is stale", () => {
    const s = sums([ARM_SHA, "SlideCraft_0.4.0_aarch64.dmg"], [INTEL_SHA, "SlideCraft_0.4.0_x64.dmg"]);
    expect(caskMatchesSums(armIntelCask(ARM_SHA, OTHER_SHA), s, "0.4.0")).toBe(false);
  });

  it("does NOT match a malformed cask with zero sha256 lines (never silently pass)", () => {
    const s = sums([ARM_SHA, "SlideCraft_0.4.0_aarch64.dmg"]);
    expect(caskMatchesSums('cask "slidecraft" do\n  version "0.4.0"\nend\n', s, "0.4.0")).toBe(false);
  });
});
