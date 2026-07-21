// verify-cask.mjs — fail the release if the Homebrew cask's sha256 doesn't match the published dmg.
//
// `npm run version:set` (scripts/bump-version.mjs) bumps the cask's `version` field as part of the
// single version bump across all files, but it does NOT touch `sha256` — that can only be computed
// after the .dmg actually exists. That leaves a window where the cask reads "version=NEW,
// sha256=OLD" until someone remembers to run `update-cask.mjs` and commit the result (hit for real
// at v0.4.0 — Issue #287). This script closes the window: wired into release.yml right after
// SHA256SUMS is generated (and before a human publishes the draft release), so a stale cask fails
// the job instead of shipping a `brew install` that serves the wrong binary.
//
//   node scripts/verify-cask.mjs <version> <path-to-SHA256SUMS>
//
// Reuses caskMatchesSums from update-cask.mjs — same sha reading/matching logic in both directions
// (write vs. verify), not duplicated (R8).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { caskMatchesSums } from "./update-cask.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const caskPath = join(here, "..", "packaging", "homebrew", "Casks", "slidecraft.rb");

function main() {
  const [rawVersion, sumsPath] = process.argv.slice(2);
  if (!rawVersion || !sumsPath) {
    console.error("usage: node scripts/verify-cask.mjs <version> <path-to-SHA256SUMS>");
    process.exit(1);
  }
  const version = rawVersion.replace(/^v/, "");

  const caskText = readFileSync(caskPath, "utf8");
  const sumsText = readFileSync(sumsPath, "utf8");

  if (!caskMatchesSums(caskText, sumsText, version)) {
    console.error(
      `verify-cask: packaging/homebrew/Casks/slidecraft.rb's sha256 does NOT match SHA256SUMS for v${version}. ` +
        `Run \`node scripts/update-cask.mjs ${version}\` and commit the result before publishing this release.`,
    );
    process.exit(1);
  }
  console.log(`✓ cask sha256 matches SHA256SUMS for v${version}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
