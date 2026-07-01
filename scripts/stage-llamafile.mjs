// stage-llamafile.mjs — stage the bundled llamafile runtime as the Tauri externalBin sidecar
// (src-tauri/binaries/llamafile-<triple>[.exe]) so a packaged app runs the in-app offline AI on a
// machine with NO llamafile. Downloads the pinned THIN launcher (a Cosmopolitan APE), VERIFIES its
// SHA256, then (on macOS/Linux) `--assimilate`s it to the host's NATIVE format (ELF/Mach-O) so it
// runs cleanly (no stale-binfmt hijack) and can be codesigned. Assimilation is HOST-NATIVE, so the
// target triple's OS must match the runner — true in the release matrix (each triple on its own OS).
//
//   node scripts/stage-llamafile.mjs [target-triple] [--force]
//
// Default triple = the Rust host. Run BEFORE `tauri build` — or via `npm run build:desktop`.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, chmodSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LLAMAFILE_VERSION = "0.10.3"; // pinned Mozilla-Ocho release
const LLAMAFILE_SHA256 = "a7d13ccf90c3a71122f983d801692471f427fbb718d36ad1194d28a700da0b4f"; // llamafile-0.10.3-thin
const here = dirname(fileURLToPath(import.meta.url));
const binDir = join(here, "..", "src-tauri", "binaries");

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const triple = argv.find((a) => !a.startsWith("--")) ?? execSync("rustc --print host-tuple").toString().trim();

// Upstream is ONE universal APE; only the dest filename ext + native OS vary per triple. Keep a
// per-triple MAP so a per-OS native build can diverge later, and to gate supported triples.
const MAP = {
  "x86_64-pc-windows-msvc": { ext: ".exe", os: "windows" },
  "aarch64-pc-windows-msvc": { ext: ".exe", os: "windows" },
  "aarch64-apple-darwin": { ext: "", os: "macos" },
  "x86_64-apple-darwin": { ext: "", os: "macos" },
  "x86_64-unknown-linux-gnu": { ext: "", os: "linux" },
  "aarch64-unknown-linux-gnu": { ext: "", os: "linux" },
};
const m = MAP[triple];
if (!m) {
  console.error(`stage-llamafile: unsupported target triple '${triple}'. Add it to MAP.`);
  process.exit(1);
}

const dest = join(binDir, `llamafile-${triple}${m.ext}`);
if (existsSync(dest) && !force) {
  console.log(`llamafile sidecar already staged: ${dest}  (use --force to re-download)`);
  process.exit(0);
}
mkdirSync(binDir, { recursive: true });

const url = `https://github.com/Mozilla-Ocho/llamafile/releases/download/${LLAMAFILE_VERSION}/llamafile-${LLAMAFILE_VERSION}-thin`;
console.log(`Downloading ${url} ...`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`download failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());

// Verify the UPSTREAM APE's SHA256 BEFORE assimilating (assimilate rewrites the file → new hash).
const got = createHash("sha256").update(buf).digest("hex");
if (got !== LLAMAFILE_SHA256) {
  console.error(`stage-llamafile: SHA256 mismatch — refusing to stage an unverified runtime.\n  expected ${LLAMAFILE_SHA256}\n  got      ${got}`);
  process.exit(1);
}
writeFileSync(dest, buf);
if (m.os !== "windows") chmodSync(dest, 0o755);

// Assimilate the polyglot APE → the host's NATIVE format so it runs without a stale-binfmt hijack
// (e.g. WSL) and can be codesigned. Windows runs the raw APE fine as a PE (named .exe), and Windows
// distribution is signing-free (Scoop), so skip assimilate there. `sh <file> --assimilate` uses the
// APE's shell prefix to bootstrap the loader even when binfmt would otherwise intercept it.
if (m.os !== "windows") {
  try {
    execSync(`sh "${dest}" --assimilate`, { stdio: "inherit" });
    chmodSync(dest, 0o755); // assimilate may reset the mode
    console.log(`Assimilated to native ${m.os} format.`);
  } catch (e) {
    console.warn(`stage-llamafile: --assimilate failed (${e.message}); shipping the raw APE.`);
  }
}
console.log(`Staged ${dest}  (llamafile ${LLAMAFILE_VERSION} thin, ${(statSync(dest).size / 1048576).toFixed(1)} MB)`);
