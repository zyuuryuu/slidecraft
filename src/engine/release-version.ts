/**
 * release-version.ts — pure semver comparison for the "new version available" notify banner
 * (Issue #113 / ADR-0021 follow-up). No fetch/DOM/Tauri here (R2); the network call lives in
 * ipc/release-check.ts.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/i;

/** Parse a version string or GitHub release tag (optionally "v"-prefixed) into numeric parts.
 *  Returns null for anything not semver-shaped, so an unexpected tag never silently compares. */
export function parseVersion(raw: string): ParsedVersion | null {
  const m = raw.trim().match(SEMVER_RE);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? null };
}

/** -1/0/1 semver precedence: major.minor.patch first, then a release outranks its own prerelease
 *  (semver §11) — a plain "1.0.0" is newer than "1.0.0-beta.1". */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : a.prerelease > b.prerelease ? 1 : 0;
}

export type UpdateVerdict =
  | { kind: "update-available"; latest: string }
  | { kind: "current" }
  | { kind: "unknown" }; // unparseable current or latest — never silently claim newer/older

/** Compare the running app's version against a GitHub release tag. */
export function evaluateUpdate(currentVersion: string, latestTag: string): UpdateVerdict {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestTag);
  if (!current || !latest) return { kind: "unknown" };
  if (compareVersions(latest, current) <= 0) return { kind: "current" };
  const suffix = latest.prerelease ? `-${latest.prerelease}` : "";
  return { kind: "update-available", latest: `${latest.major}.${latest.minor}.${latest.patch}${suffix}` };
}
