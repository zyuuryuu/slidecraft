/**
 * release-version.test.ts — pure semver comparison for the "new version available" banner
 * (Issue #113 / ADR-0021 follow-up). Boundary cases: equal, older, newer, "v" tag prefix,
 * prerelease precedence, and malformed input (must never silently claim newer/older).
 */
import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions, evaluateUpdate } from "../src/engine/release-version";

describe("parseVersion", () => {
  it("parses a bare semver string", () => {
    expect(parseVersion("0.3.0")).toEqual({ major: 0, minor: 3, patch: 0, prerelease: null });
  });
  it("strips a leading v (GitHub tag convention)", () => {
    expect(parseVersion("v0.3.0")).toEqual({ major: 0, minor: 3, patch: 0, prerelease: null });
    expect(parseVersion("V1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
  });
  it("parses a prerelease suffix", () => {
    expect(parseVersion("v0.4.0-beta.1")).toEqual({ major: 0, minor: 4, patch: 0, prerelease: "beta.1" });
  });
  it("returns null for a malformed/unexpected tag (never silently miscompares)", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("v1.2")).toBeNull();
    expect(parseVersion("not-a-version")).toBeNull();
  });
});

describe("compareVersions", () => {
  const v = (s: string) => parseVersion(s)!;
  it("orders by major/minor/patch", () => {
    expect(compareVersions(v("1.0.0"), v("1.0.0"))).toBe(0);
    expect(compareVersions(v("1.0.0"), v("2.0.0"))).toBe(-1);
    expect(compareVersions(v("2.0.0"), v("1.0.0"))).toBe(1);
    expect(compareVersions(v("1.2.0"), v("1.3.0"))).toBe(-1);
    expect(compareVersions(v("1.2.3"), v("1.2.4"))).toBe(-1);
  });
  it("a release outranks a prerelease at the same major.minor.patch", () => {
    expect(compareVersions(v("1.0.0"), v("1.0.0-beta.1"))).toBe(1);
    expect(compareVersions(v("1.0.0-beta.1"), v("1.0.0"))).toBe(-1);
  });
  it("prerelease strings compare lexicographically when both present", () => {
    expect(compareVersions(v("1.0.0-alpha"), v("1.0.0-beta"))).toBe(-1);
    expect(compareVersions(v("1.0.0-beta"), v("1.0.0-beta"))).toBe(0);
  });
});

describe("evaluateUpdate — the boundary the banner decision rests on", () => {
  it("same version → current (no banner)", () => {
    expect(evaluateUpdate("0.3.0", "v0.3.0")).toEqual({ kind: "current" });
  });
  it("newer release tag → update-available with the normalized (v-stripped) version", () => {
    expect(evaluateUpdate("0.3.0", "v0.4.0")).toEqual({ kind: "update-available", latest: "0.4.0" });
  });
  it("older release tag (e.g. a local dev build ahead of the last release) → current, not update-available", () => {
    expect(evaluateUpdate("0.3.0", "v0.2.9")).toEqual({ kind: "current" });
  });
  it("malformed current or latest → unknown (never a false 'update available')", () => {
    expect(evaluateUpdate("0.3.0", "not-a-tag")).toEqual({ kind: "unknown" });
    expect(evaluateUpdate("garbage", "v0.4.0")).toEqual({ kind: "unknown" });
  });
});
