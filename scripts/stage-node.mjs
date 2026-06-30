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
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const NODE_VERSION = "v22.11.0"; // pinned LTS; host.cjs is esbuild --target=node20, so node20+ runs it
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
writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
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
