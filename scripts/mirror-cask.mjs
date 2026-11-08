// mirror-cask.mjs — copy the canonical Homebrew cask into a checkout of the tap repo (Issue #288).
//
// The canonical cask lives here (packaging/homebrew/Casks/slidecraft.rb); `brew install` actually
// reads the copy in the tap repo `zyuuryuu/homebrew-slidecraft` (Casks/slidecraft.rb). On a release
// publish, .github/workflows/cask-mirror.yml runs update-cask.mjs (write the new sha256), then
// verify-cask.mjs (hard gate against the published SHA256SUMS), then this script against a fresh
// clone of the tap, then commits + pushes the tap. This script only decides and writes the file;
// git is the workflow's job.
//
//   node scripts/mirror-cask.mjs <tap-dir>             # write <tap-dir>/Casks/slidecraft.rb
//   node scripts/mirror-cask.mjs <tap-dir> --dry-run   # print the planned change, write nothing
//
// Refuses (exit 1, never-silent) a canonical cask with no version / an unexpected sha256 count, and a
// downgrade of what the tap already serves. Same exitCode-and-unwind convention as update-cask.mjs.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, parseCaskShas, parseCaskVersion } from "./update-cask.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const canonicalPath = join(here, "..", "packaging", "homebrew", "Casks", "slidecraft.rb");
/** Path of the cask inside the tap repo (Homebrew's `Casks/<token>.rb` convention). */
export const TAP_CASK_PATH = join("Casks", "slidecraft.rb");

const fields = (text) => ({ version: parseCaskVersion(text), shas: parseCaskShas(text) });

/**
 * Decide what the tap's cask becomes. Pure (no I/O): `tapText` is the tap's current cask, or null
 * when the tap has none yet. The tap copy is the canonical cask byte-for-byte (the canonical file's
 * header already says it is the source of truth for the mirror).
 *
 * @returns {{ ok: false, reason: string }
 *   | { ok: true, changed: boolean, content: string, from: {version: string|null, shas: string[]}|null,
 *       to: {version: string, shas: string[]}, summary: string, commitMessage: string }}
 */
export function planTapUpdate(canonicalText, tapText) {
  const to = fields(canonicalText);
  if (!to.version) return { ok: false, reason: 'canonical cask has no version "…" line — check the template' };
  if (to.shas.length < 1 || to.shas.length > 2) {
    return { ok: false, reason: `canonical cask must carry 1 or 2 sha256 lines, found ${to.shas.length}` };
  }
  const from = tapText === null ? null : fields(tapText);
  if (from?.version) {
    const cmp = compareVersions(to.version, from.version);
    if (Number.isNaN(cmp)) {
      return { ok: false, reason: `cannot order versions "${from.version}" (tap) and "${to.version}" (canonical) — refusing to guess` };
    }
    if (cmp < 0) {
      return { ok: false, reason: `refusing to downgrade the tap from ${from.version} to ${to.version}` };
    }
  }
  const base = { ok: true, content: canonicalText, from, to, commitMessage: `slidecraft ${to.version}` };
  if (tapText === canonicalText) {
    return { ...base, changed: false, summary: `tap cask already up to date (version ${to.version})` };
  }
  const lines = [];
  if (from === null) lines.push(`new cask: version ${to.version}`);
  else if (from.version !== to.version) lines.push(`version ${from.version} → ${to.version}`);
  to.shas.forEach((sha, i) => {
    const old = from?.shas[i];
    if (old !== sha) lines.push(`sha256[${i}] ${old ?? "(none)"} → ${sha}`);
  });
  if (from !== null && lines.length === 0) lines.push("non-version/sha256 lines differ (template change)");
  return { ...base, changed: true, summary: lines.join("\n") };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const tapDir = args.find((a) => !a.startsWith("--"));
  if (!tapDir) {
    console.error("usage: node scripts/mirror-cask.mjs <tap-dir> [--dry-run]");
    process.exitCode = 1;
    return;
  }
  const target = join(tapDir, TAP_CASK_PATH);
  const plan = planTapUpdate(readFileSync(canonicalPath, "utf8"), existsSync(target) ? readFileSync(target, "utf8") : null);
  if (!plan.ok) {
    console.error(`mirror-cask: ${plan.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${dryRun ? "[dry-run] " : ""}${target}:\n${plan.summary}`);
  if (!plan.changed || dryRun) return;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, plan.content);
  console.log(`Wrote ${target} (commit message: "${plan.commitMessage}")`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
