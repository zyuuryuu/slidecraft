// stage-node.mjs — CROSS-PLATFORM: stage a pinned Node runtime as the Tauri externalBin sidecar
// (src-tauri/binaries/node-<triple>[.exe]) so a packaged app can run the collab host (dist/mcp/
// host.cjs) on a machine with NO Node. Replaces the Windows-only stage-node.ps1.
//
//   node scripts/stage-node.mjs [target-triple] [--force]
//
// Default triple = the Rust host (rustc --print host-tuple). CI passes the matrix target explicitly
// (e.g. node scripts/stage-node.mjs aarch64-apple-darwin). Run BEFORE `tauri build` — or use
// `npm run build:desktop`, which chains this then the build with the bundle overlay.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, chmodSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const NODE_VERSION = "v22.11.0"; // pinned LTS; host.cjs is esbuild --target=node20, so node20+ runs it
// Pinned SHA256 of each nodejs.org archive (from https://nodejs.org/dist/<ver>/SHASUMS256.txt),
// verified BEFORE extraction so a corrupted / MITM'd / mirror-swapped download can't ship a hostile
// Node into the installer (ADR-0016 F4, mirrors stage-llamafile.mjs). UPDATE when bumping
// NODE_VERSION — fails closed: an unlisted or mismatched archive is refused.
const SHA256 = {
  "win-x64.zip": "905373a059aecaf7f48c1ce10ffbd5334457ca00f678747f19db5ea7d256c236",
  "win-arm64.zip": "b9ff5a6b6ffb68a0ffec82cc5664ed48247dabbd25ee6d129facd2f65a8ca80d",
  "darwin-arm64.tar.gz": "2e89afe6f4e3aa6c7e21c560d8a0453d84807e97850bbb819b998531a22bdfde",
  "darwin-x64.tar.gz": "668d30b9512137b5f5baeef6c1bb4c46efff9a761ba990a034fb6b28b9da2465",
  "linux-x64.tar.gz": "4f862bab52039835efbe613b532238b6e4dde98d139a34e6923193e073438b13",
  "linux-arm64.tar.gz": "27453f7a0dd6b9e6738f1f6ea6a09b102ec7aa484de1e39d6a1c3608ad47aa6a",
};
const here = dirname(fileURLToPath(import.meta.url));
const binDir = join(here, "..", "src-tauri", "binaries");

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const triple = argv.find((a) => !a.startsWith("--")) ?? execSync("rustc --print host-tuple").toString().trim();

// Rust target triple → nodejs.org dist artifact + path to the node binary inside it.
const MAP = {
  "x86_64-pc-windows-msvc": { dist: "win-x64", bin: "node.exe", ext: ".exe" },
  "aarch64-pc-windows-msvc": { dist: "win-arm64", bin: "node.exe", ext: ".exe" },
  "aarch64-apple-darwin": { dist: "darwin-arm64", bin: "bin/node", ext: "" },
  "x86_64-apple-darwin": { dist: "darwin-x64", bin: "bin/node", ext: "" },
  "x86_64-unknown-linux-gnu": { dist: "linux-x64", bin: "bin/node", ext: "" },
  "aarch64-unknown-linux-gnu": { dist: "linux-arm64", bin: "bin/node", ext: "" },
};
const m = MAP[triple];
if (!m) {
  console.error(`stage-node: unsupported target triple '${triple}'. Add it to MAP.`);
  process.exit(1);
}

const dest = join(binDir, `node-${triple}${m.ext}`);
if (existsSync(dest) && !force) {
  console.log(`node sidecar already staged: ${dest}  (use --force to re-download)`);
  process.exit(0);
}
mkdirSync(binDir, { recursive: true });

const isWin = m.dist.startsWith("win");
const archiveExt = isWin ? "zip" : "tar.gz";
const stem = `node-${NODE_VERSION}-${m.dist}`;
const url = `https://nodejs.org/dist/${NODE_VERSION}/${stem}.${archiveExt}`;
const tmp = join(tmpdir(), `slidecraft-node-${triple}`);
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const archive = join(tmp, `node.${archiveExt}`);

console.log(`Downloading ${url} ...`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`download failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
// Verify the pinned SHA256 BEFORE writing/extracting — refuse to stage an unverified runtime.
const want = SHA256[`${m.dist}.${archiveExt}`];
const got = createHash("sha256").update(buf).digest("hex");
if (!want || got !== want) {
  console.error(`stage-node: SHA256 mismatch for ${stem}.${archiveExt} — refusing to stage an unverified runtime.\n  expected ${want ?? "<no pinned hash — update SHA256 in stage-node.mjs>"}\n  got      ${got}`);
  process.exit(1);
}
writeFileSync(archive, buf);
// bsdtar (Windows 10+ / macOS / Linux all ship it) extracts BOTH .zip and .tar.gz.
execSync(`tar -xf "${archive}" -C "${tmp}"`, { stdio: "inherit" });

const srcBin = join(tmp, stem, m.bin);
if (!existsSync(srcBin)) {
  console.error(`node binary not found in archive: ${srcBin}`);
  process.exit(1);
}
copyFileSync(srcBin, dest);
if (!isWin) chmodSync(dest, 0o755);
rmSync(tmp, { recursive: true, force: true });
console.log(`Staged ${dest}  (Node ${NODE_VERSION} ${m.dist}, ${(statSync(dest).size / 1048576).toFixed(1)} MB)`);
