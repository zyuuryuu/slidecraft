// extract-changelog-section.mjs — pull one version's release notes out of CHANGELOG.md for
// release.yml's releaseBody (Issue #258). CHANGELOG.md follows Keep a Changelog: each version
// starts at a "## [x.y.z] - date" heading and runs through (not including) the next "## [" heading.
//
//   node scripts/extract-changelog-section.mjs <ref-or-version> [--allow-missing]
//
// Prints the section body to stdout. Never-silent: a missing/empty section is a hard error
// (exit 1) unless --allow-missing is passed, in which case a warning goes to stderr and a
// placeholder body is printed instead — used only for workflow_dispatch test runs, which build
// an arbitrary ref that isn't necessarily a tagged CHANGELOG.md entry.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HEADING_RE = /^## \[([^\]]+)\][^\n]*$/gm;

// Returns the trimmed section body, "" if the heading exists but the section is empty, or null
// if no heading matches `version` at all.
export function extractChangelogSection(changelog, version) {
  HEADING_RE.lastIndex = 0;
  let match;
  let sectionStart = -1;
  let sectionEnd = changelog.length;
  while ((match = HEADING_RE.exec(changelog))) {
    if (sectionStart === -1) {
      if (match[1] === version) sectionStart = HEADING_RE.lastIndex;
      continue;
    }
    sectionEnd = match.index;
    break;
  }
  if (sectionStart === -1) return null;
  return changelog.slice(sectionStart, sectionEnd).trim();
}

async function main() {
  const [, , rawRef, ...flags] = process.argv;
  const allowMissing = flags.includes("--allow-missing");
  if (!rawRef) {
    console.error("usage: node scripts/extract-changelog-section.mjs <ref-or-version> [--allow-missing]");
    process.exit(1);
  }
  const version = rawRef.replace(/^v/, "");

  const here = dirname(fileURLToPath(import.meta.url));
  const changelogPath = join(here, "..", "CHANGELOG.md");
  const changelog = readFileSync(changelogPath, "utf8");

  const body = extractChangelogSection(changelog, version);

  if (body === null) {
    const message = `extract-changelog-section: no "## [${version}]" section found in CHANGELOG.md`;
    if (allowMissing) {
      console.error(`WARNING: ${message} — this is expected for a workflow_dispatch test run, not a tagged release.`);
      console.log(`_(No CHANGELOG.md section found for "${version}".)_`);
      return;
    }
    console.error(message);
    console.error(`Add a "## [${version}] - YYYY-MM-DD" section to CHANGELOG.md before tagging (see RELEASING.md).`);
    process.exit(1);
  }

  if (body === "") {
    const message = `extract-changelog-section: "## [${version}]" section in CHANGELOG.md is empty`;
    if (allowMissing) {
      console.error(`WARNING: ${message}.`);
      console.log(`_(CHANGELOG.md section for "${version}" is empty.)_`);
      return;
    }
    console.error(message);
    process.exit(1);
  }

  console.log(body);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
