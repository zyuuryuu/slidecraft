// build-desktop.mjs — `npm run build:desktop`: stage both sidecars for the host target, then run
// `tauri build` with the release-only bundle overlays for that target (scripts/node-sidecar.mjs).
//
// Was an npm one-liner with a single hardcoded `--config src-tauri/tauri.bundle.conf.json`. Since #527 a
// Linux build ALSO needs tauri.bundle.linux.conf.json (Node sidecar → /usr/bin/slidecraft-node, never
// /usr/bin/node), which an OS-agnostic npm script line cannot add conditionally. Extra CLI args are
// passed through to `tauri build` (e.g. `npm run build:desktop -- --bundles deb`).
import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleConfigArgs } from "./node-sidecar.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const triple = execSync("rustc --print host-tuple").toString().trim();

/** Run a command from the repo root, inheriting stdio; exit with its status on failure (never silent). */
function step(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  // npm is npm.cmd on Windows, which spawn can only start through a shell; no arg here contains spaces.
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`build-desktop: '${cmd} ${args.join(" ")}' failed (${r.error?.message ?? `exit ${r.status}`})`);
    process.exit(r.status || 1);
  }
}

step(process.execPath, [join("scripts", "stage-node.mjs"), triple]);
step(process.execPath, [join("scripts", "stage-llamafile.mjs"), triple]);
step("npm", ["run", "tauri", "--", "build", ...bundleConfigArgs(triple), ...process.argv.slice(2)]);
