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

const armSha = await sha256("aarch64", armLocal);
const intelSha = await sha256("x64", intelLocal);

let cask = readFileSync(caskPath, "utf8");
cask = cask.replace(/version "[^"]*"/, `version "${version}"`);

// Rewrite the sha256 inside each on_arch block (order in the file: on_arm, then on_intel).
let seen = 0;
cask = cask.replace(/sha256 "[0-9a-f]{64}"( # [^\n]*)?/g, () => {
  const sha = seen++ === 0 ? armSha : intelSha;
  return `sha256 "${sha}"`;
});
if (seen !== 2) {
  console.error(`update-cask: expected 2 sha256 lines in the cask, patched ${seen}. Check the template.`);
  process.exit(1);
}

writeFileSync(caskPath, cask);
console.log(`Updated ${caskPath}`);
console.log(`  version   ${version}`);
console.log(`  aarch64   ${armSha}`);
console.log(`  x64       ${intelSha}`);
