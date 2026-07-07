// update-cask.mjs — refresh packaging/homebrew/Casks/slidecraft.rb for a published release.
//
// The macOS .dmg assets are ad-hoc signed (not notarized) and distributed through a Homebrew cask,
// which needs the exact SHA256 of each arch's .dmg. This computes them and rewrites the cask's
// `version` + both `sha256` lines in place, so publishing a new version is one command.
//
//   node scripts/update-cask.mjs <version>                       # download both .dmgs from the release
//   node scripts/update-cask.mjs <version> <arm.dmg> <x64.dmg>   # hash local .dmg files instead
//
// After running, copy the updated cask into the `zyuuryuu/homebrew-slidecraft` tap (see
// packaging/homebrew/README.md) and commit.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const caskPath = join(here, "..", "packaging", "homebrew", "Casks", "slidecraft.rb");
const REPO = "zyuuryuu/slidecraft";

const [version, armLocal, intelLocal] = process.argv.slice(2);
if (!version) {
  console.error("usage: node scripts/update-cask.mjs <version> [arm.dmg] [x64.dmg]");
  process.exit(1);
}

async function sha256(arch, localPath) {
  let buf;
  if (localPath) {
    if (!existsSync(localPath)) {
      console.error(`update-cask: local file not found: ${localPath}`);
      process.exit(1);
    }
    buf = readFileSync(localPath);
  } else {
    const url = `https://github.com/${REPO}/releases/download/v${version}/SlideCraft_${version}_${arch}.dmg`;
    console.log(`Downloading ${url} ...`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`update-cask: download failed (${res.status} ${res.statusText}) for ${url}`);
      process.exit(1);
    }
    buf = Buffer.from(await res.arrayBuffer());
  }
  return createHash("sha256").update(buf).digest("hex");
}

let cask = readFileSync(caskPath, "utf8");

// Fail-closed guard: the `slidecraft-mcp` binary stanza only works on .dmgs that BUNDLE the wrapper,
// which first ships in v0.2.0 (ADR-0022). Refuse to emit a cask that pairs that stanza with an older
// version — otherwise `brew install` would fail on the missing binary target. Blocks the footgun of
// re-cutting the cask for v0.1.0 while the source template already carries the stanza.
const MIN_LAUNCHER_VERSION = [0, 2, 0];
const hasLauncherStanza = /binary\s+["'][^"']*slidecraft-mcp["']/.test(cask);
const semver = version.replace(/^v/, "").split(".").map((n) => parseInt(n, 10));
// negative if a < b, 0 if equal, positive if a > b (missing components treated as 0)
const cmpVersion = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};
if (hasLauncherStanza && (semver.some(Number.isNaN) || cmpVersion(semver, MIN_LAUNCHER_VERSION) < 0)) {
  console.error(
    `update-cask: refusing to emit a cask with the slidecraft-mcp launcher for version "${version}". ` +
      `That launcher first ships in v${MIN_LAUNCHER_VERSION.join(".")} (ADR-0022); an older .dmg lacks it and brew install would fail.`,
  );
  process.exit(1);
}

cask = cask.replace(/version "[^"]*"/, `version "${version}"`);

// The cask may be arm64-only (1 sha256) or arm+intel (2, order: on_arm then on_intel). Match the
// current template so we don't download an Intel .dmg that isn't built.
const shaCount = (cask.match(/sha256 "[0-9a-f]{64}"/g) ?? []).length;
if (shaCount < 1 || shaCount > 2) {
  console.error(`update-cask: expected 1 (arm64-only) or 2 (arm+intel) sha256 lines, found ${shaCount}. Check the template.`);
  process.exit(1);
}
const armSha = await sha256("aarch64", armLocal);
const intelSha = shaCount === 2 ? await sha256("x64", intelLocal) : null;

// Rewrite each sha256 in file order (arm first, intel second if present).
let seen = 0;
cask = cask.replace(/sha256 "[0-9a-f]{64}"( # [^\n]*)?/g, () => `sha256 "${seen++ === 0 ? armSha : intelSha}"`);

writeFileSync(caskPath, cask);
console.log(`Updated ${caskPath}`);
console.log(`  version   ${version}`);
console.log(`  aarch64   ${armSha}`);
console.log(`  x64       ${intelSha}`);
