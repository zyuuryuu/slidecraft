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
//
// Failures set `process.exitCode` and return instead of calling `process.exit()`: on Windows Git
// Bash (the release matrix's windows-latest runner), `process.exit()` fired right after a stderr
// write can terminate before the async pipe flush completes, dropping BOTH the error message and
// the non-zero code — so the never-silent guard silently passed and a draft shipped with an empty
// releaseBody (Issue #316). Setting exitCode + returning lets Node drain stdio and exit naturally.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HEADING_RE = /^## \[([^\]]+)\][^\n]*$/gm;
const REPO_BLOB_BASE = "https://github.com/zyuuryuu/slidecraft/blob/main/";
const MARKDOWN_LINK_RE = /\]\(([^)]+)\)/g;

// GitHub Release bodies have no repo file context, so CHANGELOG.md's relative doc links
// (e.g. "docs/adr/0033-....md") break there — see extractChangelogSection's header comment
// (Issue #289). Rewrites only markdown-link targets that are relative repo paths (no
// scheme, not an in-page "#anchor"); absolute http(s) links (issue/PR references) and
// anchors pass through untouched. CHANGELOG.md itself keeps relative links, which render
// correctly on the docs site and in GitHub's own file view.
export function absolutizeRepoLinks(markdown) {
  return markdown.replace(MARKDOWN_LINK_RE, (full, target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return full;
    return `](${REPO_BLOB_BASE}${target})`;
  });
}

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
    process.exitCode = 1;
    return;
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
    process.exitCode = 1;
    return;
  }

  if (body === "") {
    const message = `extract-changelog-section: "## [${version}]" section in CHANGELOG.md is empty`;
    if (allowMissing) {
      console.error(`WARNING: ${message}.`);
      console.log(`_(CHANGELOG.md section for "${version}" is empty.)_`);
      return;
    }
    console.error(message);
    process.exitCode = 1;
    return;
  }

  console.log(absolutizeRepoLinks(body));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
