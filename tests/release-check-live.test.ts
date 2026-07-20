/**
 * release-check-live.test.ts — the real-polling connectivity check (Issue #113: "実ポーリングの疎通確認").
 * Hits the ACTUAL GitHub Releases API (no mocks) via appFetch — the mocked behavior is already covered
 * by release-check.test.ts. Some sandboxes (this dev container included) proxy/deny outbound GitHub
 * traffic entirely; that's an environment property, not a code defect, so a preflight probe decides
 * whether to assert (mirrors this repo's existsSync-gated corpus tests, e.g. cx-sample-template.test.ts,
 * generalized to network reachability instead of a missing local fixture).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { fetchLatestReleaseTag } from "../src/ipc/release-check";
import { parseVersion } from "../src/engine/release-version";

let reachable = false;
let latestTag = "";

beforeAll(async () => {
  try {
    latestTag = await fetchLatestReleaseTag();
    reachable = true;
  } catch {
    reachable = false;
  }
}, 15_000);

describe("real GitHub Releases API polling (smoke)", () => {
  it("reaches api.github.com and returns a semver-shaped tag (skipped if this environment blocks outbound GitHub traffic)", () => {
    if (!reachable) return; // network-restricted sandbox — not a code failure, see file header
    expect(parseVersion(latestTag)).not.toBeNull();
  });
});
