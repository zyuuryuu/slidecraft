// mcpb-manifest.mjs — the ONE place that decides what SlideCraft's Claude Desktop bundle (`.mcpb`, #517 子 3)
// contains: the manifest (pure — built from target + version) and the file list. scripts/build-mcpb.mjs stages
// a directory from these; release.yml packs it with the official `mcpb pack` (@anthropic-ai/mcpb, pinned in
// package-lock) and attaches it to the draft release. Pinned by tests/mcpb-bundle.test.ts.
//
// Format: MCPB manifest spec, manifest_version 0.3 (github.com/modelcontextprotocol/mcpb MANIFEST.md, "Current
// version: 0.3"). A `.mcpb` is a zip with manifest.json at its root.
//
// Why `server.type: "binary"` with OUR node, one bundle per OS: the spec's `node` type runs on the Node that
// ships inside Claude Desktop (macOS/Windows only; its version is not specified). ADR-0022 ships SlideCraft's
// own Node so the server never depends on a runtime we do not control, and cli.cjs targets node20. So each
// bundle carries the same Node runtime the installers ship (staged by stage-node.mjs) — ~40 MB compressed per
// bundle. Linux has no Claude Desktop → no bundle.
//
// The command is spelled `${__dirname}/server/node` on BOTH OSes: the Windows bundle ships `server/node.exe`,
// and the spawn resolves the missing extension (the spec: "apps will automatically append .exe on Windows";
// libuv's spawn also tries .exe). One spelling avoids a double `.exe` if an app appends unconditionally.
//
// No `--root` arg: --no-fs (base64) stays the default (#517 invariant). A user_config for the scope directory
// would need an always-present arg, so it is left out rather than shipping an empty `--root`.

import { nodeSidecarName } from "./node-sidecar.mjs";

export const MCPB_MANIFEST_VERSION = "0.3";

/** Bundle target → the release matrix triple whose staged node it carries, and its MCPB platform. */
export const MCPB_TARGETS = {
  "darwin-arm64": { triple: "aarch64-apple-darwin", platform: "darwin" },
  "win32-x64": { triple: "x86_64-pc-windows-msvc", platform: "win32" },
};

function targetOf(target) {
  const t = MCPB_TARGETS[target];
  if (!t) throw new Error(`unknown .mcpb target "${target}" (known: ${Object.keys(MCPB_TARGETS).join(", ")})`);
  return t;
}

/** The release triple's bundle target, or null when that OS has no Claude Desktop (Linux). */
export function mcpbTargetForTriple(triple) {
  return Object.entries(MCPB_TARGETS).find(([, t]) => t.triple === triple)?.[0] ?? null;
}

/** Release asset file name. Version-free, so the GUI can find it in any release (src/ipc/mcpb-asset.ts, R8). */
export function mcpbAssetName(target) {
  targetOf(target);
  return `slidecraft-${target}.mcpb`;
}

/** Where stage-node.mjs leaves the Node runtime for this target (src-tauri/binaries/<name>-<triple>[.exe]). */
export function stagedNodePath(target) {
  const { triple } = targetOf(target);
  const ext = triple.includes("windows") ? ".exe" : "";
  return `src-tauri/binaries/${nodeSidecarName(triple)}-${triple}${ext}`;
}

/** Files copied into the bundle (repo-relative `from` → bundle-relative `to`). manifest.json is written, not copied. */
export function mcpbFiles(target) {
  const { platform } = targetOf(target);
  return [
    { from: "src-tauri/icons/icon.png", to: "icon.png" },
    { from: "dist/mcp/cli.cjs", to: "server/cli.cjs" },
    { from: stagedNodePath(target), to: platform === "win32" ? "server/node.exe" : "server/node" },
  ];
}

/** The manifest.json for `target` at app `version` (tauri.conf.json's version). */
export function buildMcpbManifest(target, version) {
  const { platform } = targetOf(target);
  if (typeof version !== "string" || !version) throw new Error(`.mcpb manifest needs the app version (got ${JSON.stringify(version)})`);
  return {
    manifest_version: MCPB_MANIFEST_VERSION,
    name: "slidecraft",
    display_name: "SlideCraft",
    version,
    description: "Markdown / YAML から PowerPoint（.pptx）を作る SlideCraft の MCP サーバ。AI がデッキの作成・編集・検査・書き出しを行えます。",
    author: { name: "zyuuryuu", url: "https://github.com/zyuuryuu" },
    repository: { type: "git", url: "https://github.com/zyuuryuu/slidecraft" },
    homepage: "https://github.com/zyuuryuu/slidecraft",
    documentation: "https://zyuuryuu.github.io/slidecraft/guide/mcp",
    support: "https://github.com/zyuuryuu/slidecraft/issues",
    license: "Apache-2.0",
    icon: "icon.png",
    server: {
      type: "binary",
      entry_point: "server/node",
      mcp_config: { command: "${__dirname}/server/node", args: ["${__dirname}/server/cli.cjs"] },
    },
    compatibility: { platforms: [platform] },
  };
}
