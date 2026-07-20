/**
 * extract-changelog-section.test.ts — pure section extraction for release.yml's releaseBody
 * (Issue #258). release.yml currently hardcodes a fixed releaseBody that never reflects the
 * actual per-version changes; the fix pulls the tagged version's own "## [x.y.z] - date"
 * section out of CHANGELOG.md instead. Boundary cases: a middle section (bounded by the next
 * heading), the last section (bounded by EOF), a missing version, and an empty section — the
 * two "not found" shapes must be distinguishable so the CLI wrapper can fail loudly instead of
 * silently emitting an empty release body.
 */
import { describe, it, expect } from "vitest";
import { extractChangelogSection } from "../scripts/extract-changelog-section.mjs";

const CHANGELOG = `# Changelog

Intro text that must not leak into any section.

## [Unreleased]

### Added

- something not yet released

## [0.3.0] - 2026-07-08

### Added

- faithful Re-make

### Changed / Removed

- AI Re-make removed

## [0.2.2] - 2026-07-08

### Fixed

- title placeholder bug

## [0.1.0] - 2026-07-07

Initial public release.
`;

describe("extractChangelogSection", () => {
  it("extracts a middle section, stopping at the next heading", () => {
    const body = extractChangelogSection(CHANGELOG, "0.3.0");
    expect(body).toContain("faithful Re-make");
    expect(body).toContain("AI Re-make removed");
    expect(body).not.toContain("title placeholder bug");
    expect(body).not.toContain("[0.2.2]");
  });

  it("extracts the last section through end of file", () => {
    const body = extractChangelogSection(CHANGELOG, "0.1.0");
    expect(body).toContain("Initial public release.");
  });

  it("returns null when the version heading does not exist", () => {
    expect(extractChangelogSection(CHANGELOG, "9.9.9")).toBeNull();
  });

  it("returns an empty string (not null) when the section heading exists but has no body", () => {
    const withEmpty = CHANGELOG.replace(
      "## [0.2.2] - 2026-07-08\n\n### Fixed\n\n- title placeholder bug\n\n",
      "## [0.2.2] - 2026-07-08\n\n",
    );
    expect(extractChangelogSection(withEmpty, "0.2.2")).toBe("");
  });

  it("does not confuse [Unreleased] with a version match", () => {
    expect(extractChangelogSection(CHANGELOG, "Unreleased")).toContain("something not yet released");
    expect(extractChangelogSection(CHANGELOG, "0.3.0")).not.toContain("something not yet released");
  });
});
