// node-sidecar.mjs — the ONE place that decides what the bundled Node sidecar is called per target, and
// which release-only bundle overlays a build for that target passes to `tauri build` (#527).
//
// Why Linux differs: Tauri's bundler installs every `externalBin` into usr/bin/ of the .deb/.rpm
// (name = externalBin entry minus the triple). Named `node`, the sidecar landed on /usr/bin/node — owned
// by Debian/Ubuntu's (and NodeSource's) `nodejs` package — so dpkg/rpm refuse the install next to a
// system Node. Linux therefore ships it as /usr/bin/slidecraft-node via tauri.bundle.linux.conf.json.
// macOS (Contents/MacOS/node) and Windows (<install dir>\node.exe) keep `node`: nothing conflicts
// there, and users registered those absolute paths directly (docs/mcp-server.md).
//
// Consumers (pinned against each other by tests/linux-node-sidecar.test.ts, R8): stage-node.mjs (staged
// file name), build-desktop.mjs (overlay args), ci.yml / release.yml (the same args spelled out),
// src-tauri/src/collab.rs (runtime resolution) and scripts/slidecraft-mcp (PATH launcher).

export const BUNDLE_OVERLAY = "src-tauri/tauri.bundle.conf.json";
export const LINUX_BUNDLE_OVERLAY = "src-tauri/tauri.bundle.linux.conf.json";

const isLinux = (triple) => /-linux-/.test(triple);

/** Base name of the Node externalBin for a Rust target triple (Tauri appends `-<triple>[.exe]` when staging). */
export function nodeSidecarName(triple) {
  return isLinux(triple) ? "slidecraft-node" : "node";
}

/** `--config` arguments for `tauri build` targeting `triple`, in merge order (later overrides earlier). */
export function bundleConfigArgs(triple) {
  const args = ["--config", BUNDLE_OVERLAY];
  if (isLinux(triple)) args.push("--config", LINUX_BUNDLE_OVERLAY);
  return args;
}
