// #527 — on Linux the bundled Node sidecar must NOT be installed as /usr/bin/node.
//
// Tauri's bundler copies every `externalBin` into usr/bin/ of the .deb/.rpm (and the AppImage tree),
// named after the externalBin entry minus the target triple. `binaries/node` therefore became
// /usr/bin/node — the path Debian/Ubuntu's (and NodeSource's) `nodejs` package owns, so dpkg/rpm
// refuse the install on any machine with a system Node (file conflict).
//
// Fix: ONLY the Linux build uses a distinct sidecar name, `slidecraft-node`, via a second release-only
// overlay (src-tauri/tauri.bundle.linux.conf.json) passed AFTER the common one. macOS
// (Contents/MacOS/node) and Windows (<install dir>\node.exe) keep their names: users registered those
// absolute paths directly (docs/mcp-server.md), and neither OS has a package-ownership conflict.
//
// Every place that names the Linux sidecar is pinned here against the others (R8): the overlay, the
// staging script, the Rust resolver (collab.rs), the POSIX launcher and the CI/release build args.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync, mkdtempSync, realpathSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { nodeSidecarName, bundleConfigArgs, BUNDLE_OVERLAY, LINUX_BUNDLE_OVERLAY } from "../scripts/node-sidecar.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const productName = (JSON.parse(read("src-tauri/tauri.conf.json")) as { productName: string }).productName;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const isObj = (v: Json): v is { [k: string]: Json } => typeof v === "object" && v !== null && !Array.isArray(v);
/** RFC 7396 JSON Merge Patch — what tauri-cli applies for the platform file and each `--config`. */
function mergePatch(target: Json, patch: Json): Json {
  if (!isObj(patch)) return patch;
  const out: { [k: string]: Json } = isObj(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k] ?? null, v);
  }
  return out;
}
type Platform = "windows" | "macos" | "linux";
const TRIPLE: Record<Platform, string> = {
  linux: "x86_64-unknown-linux-gnu",
  macos: "aarch64-apple-darwin",
  windows: "x86_64-pc-windows-msvc",
};
/** tauri.conf.json ⊕ tauri.<platform>.conf.json ⊕ each `--config` in order — the args a build for that
 *  platform actually passes (bundleConfigArgs), so this checks the real invocation, not a guess. */
function effectiveExternalBin(platform: Platform): string[] {
  let conf = JSON.parse(read("src-tauri/tauri.conf.json")) as Json;
  const platformFile = `src-tauri/tauri.${platform}.conf.json`;
  if (existsSync(join(root, platformFile))) conf = mergePatch(conf, JSON.parse(read(platformFile)) as Json);
  const args = bundleConfigArgs(TRIPLE[platform]);
  for (let i = 0; i < args.length; i += 2) {
    expect(args[i]).toBe("--config");
    conf = mergePatch(conf, JSON.parse(read(args[i + 1])) as Json);
  }
  return ((conf as { bundle: { externalBin: string[] } }).bundle.externalBin ?? []).map((b) => basename(b));
}

describe("#527 — the Linux Node sidecar is `slidecraft-node`, never `node`", () => {
  it("nodeSidecarName: Linux triples → slidecraft-node; macOS / Windows keep `node`", () => {
    expect(nodeSidecarName("x86_64-unknown-linux-gnu")).toBe("slidecraft-node");
    expect(nodeSidecarName("aarch64-unknown-linux-gnu")).toBe("slidecraft-node");
    expect(nodeSidecarName("aarch64-apple-darwin")).toBe("node");
    expect(nodeSidecarName("x86_64-apple-darwin")).toBe("node");
    expect(nodeSidecarName("x86_64-pc-windows-msvc")).toBe("node");
    expect(nodeSidecarName("aarch64-pc-windows-msvc")).toBe("node");
  });

  it("effective Linux externalBin (both overlays) has slidecraft-node + llamafile and NO `node`", () => {
    const bins = effectiveExternalBin("linux");
    expect(bins).toContain("slidecraft-node");
    expect(bins).not.toContain("node");
    expect(bins).toContain("llamafile");
  });

  it("macOS / Windows effective externalBin is unchanged: `node` (Contents/MacOS/node, node.exe)", () => {
    for (const p of ["macos", "windows"] as const) {
      expect(effectiveExternalBin(p), p).toContain("node");
      expect(effectiveExternalBin(p), p).not.toContain("slidecraft-node");
    }
  });

  it("agreement (R8): for every platform the staged name IS the effective externalBin name", () => {
    for (const p of ["linux", "macos", "windows"] as const) {
      expect(effectiveExternalBin(p), p).toContain(nodeSidecarName(TRIPLE[p]));
    }
  });

  it("the Linux overlay differs from the common one ONLY in the node entry (llamafile etc. cannot drift)", () => {
    const common = (JSON.parse(read(BUNDLE_OVERLAY)) as { bundle: { externalBin: string[] } }).bundle.externalBin;
    const linux = JSON.parse(read(LINUX_BUNDLE_OVERLAY)) as { bundle: Record<string, unknown> };
    expect(Object.keys(linux).filter((k) => k !== "$schema")).toEqual(["bundle"]);
    expect(Object.keys(linux.bundle)).toEqual(["externalBin"]);
    expect(linux.bundle.externalBin).toEqual(common.map((b) => (b === "binaries/node" ? "binaries/slidecraft-node" : b)));
  });

  it("stage-node.mjs names the staged file via nodeSidecarName (no second hardcoded `node-<triple>`)", () => {
    const stage = read("scripts/stage-node.mjs");
    expect(stage).toMatch(/import \{[^}]*nodeSidecarName[^}]*\} from "\.\/node-sidecar\.mjs"/);
    expect(stage).toMatch(/`\$\{nodeSidecarName\(triple\)\}-\$\{triple\}\$\{m\.ext\}`/);
  });

  it("collab.rs resolves `slidecraft-node` on Linux, `node.exe` on Windows, `node` elsewhere", () => {
    const rs = read("src-tauri/src/collab.rs");
    const fn = rs.slice(rs.indexOf("fn node_sidecar_file_name"), rs.indexOf("fn resolve_node"));
    expect(fn).toMatch(/target_os = "linux"[\s\S]*"slidecraft-node"/);
    expect(fn).toMatch(/windows[\s\S]*"node\.exe"/);
    expect(rs.slice(rs.indexOf("fn resolve_node"))).toMatch(/node_sidecar_file_name\(\)/);
  });

  it("ci.yml Linux smoke and the release.yml Linux matrix pass the Linux overlay after the common one", () => {
    const ci = read(".github/workflows/ci.yml");
    const build = ci.slice(ci.indexOf("\n  build:"), ci.indexOf("\n  browser-smoke:"));
    expect(build).toContain(`--config ${BUNDLE_OVERLAY} --config ${LINUX_BUNDLE_OVERLAY}`);
    const rel = read(".github/workflows/release.yml");
    const linuxEntry = rel.slice(rel.indexOf("triple: x86_64-unknown-linux-gnu") - 200, rel.indexOf("triple: x86_64-unknown-linux-gnu") + 200);
    expect(linuxEntry).toContain(`--config ${LINUX_BUNDLE_OVERLAY}`);
    expect(rel).toMatch(/--config src-tauri\/tauri\.bundle\.conf\.json \$\{\{ matrix\.overlay \}\}/);
  });

  it("npm run build:desktop goes through the same bundleConfigArgs (no Linux build without the overlay)", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["build:desktop"]).toBe("node scripts/build-desktop.mjs");
    expect(read("scripts/build-desktop.mjs")).toMatch(/bundleConfigArgs\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POSIX launcher on the new Linux layout — real execution
// ─────────────────────────────────────────────────────────────────────────────
const sh = join(root, "scripts/slidecraft-mcp");
const skipPosix = process.platform === "win32";

function writeFakeNode(path: string, tag = ""): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\nSLIDECRAFT_TEST_NODE="$0${tag}" exec "${process.execPath}" "$@"\n`);
  chmodSync(path, 0o755);
}
function writeFakeCli(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), node: process.env.SLIDECRAFT_TEST_NODE || "PATH" }));\n`);
}
function installLauncher(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(sh, path);
  chmodSync(path, 0o755);
}
function run(launcher: string, args: string[]): { status: number | null; node: string | null; stderr: string } {
  const r = spawnSync(launcher, args, { encoding: "utf8" });
  let node: string | null;
  try {
    node = (JSON.parse(r.stdout) as { node: string }).node;
  } catch {
    node = null;
  }
  return { status: r.status, node, stderr: r.stderr };
}

describe.skipIf(skipPosix)("slidecraft-mcp (sh) — Linux resolves /usr/bin/slidecraft-node, never a system /usr/bin/node", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "slidecraft 527 "));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("/usr/bin/slidecraft-mcp picks the sibling slidecraft-node even when a system /usr/bin/node exists", () => {
    const r = join(tmp, "deb");
    installLauncher(join(r, "usr/bin/slidecraft-mcp"));
    writeFakeNode(join(r, "usr/bin/slidecraft-node"));
    writeFakeNode(join(r, "usr/bin/node"), " (SYSTEM nodejs package)"); // a decoy the launcher must ignore
    writeFakeCli(join(r, `usr/lib/${productName}/cli.cjs`));
    const res = run(join(r, "usr/bin/slidecraft-mcp"), ["--flag"]);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    expect(res.node).toBe(join(r, "usr/bin/slidecraft-node"));
  });

  it("the resource-dir copy (/usr/lib/<productName>/slidecraft-mcp) reaches ../../bin/slidecraft-node", () => {
    const r = join(tmp, "res");
    installLauncher(join(r, `usr/lib/${productName}/slidecraft-mcp`));
    writeFakeNode(join(r, "usr/bin/slidecraft-node"));
    writeFakeNode(join(r, "usr/bin/node"), " (SYSTEM nodejs package)");
    writeFakeCli(join(r, `usr/lib/${productName}/cli.cjs`));
    const res = run(join(r, `usr/lib/${productName}/slidecraft-mcp`), []);
    expect(res.status).toBe(0);
    expect(realpathSync(res.node!)).toBe(realpathSync(join(r, "usr/bin/slidecraft-node")));
  });

  it("agreement (R8): the launcher's Linux candidate is the Linux sidecar name; macOS still uses MacOS/node", () => {
    const text = lf(read("scripts/slidecraft-mcp"));
    expect(text).toContain(`"$here/${nodeSidecarName(TRIPLE.linux)}"`);
    expect(text).toContain(`"$here/../../bin/${nodeSidecarName(TRIPLE.linux)}"`);
    expect(text).not.toMatch(/"\$here\/node"/); // the old candidate would now hit the SYSTEM node
    expect(text).toContain(`$here/../MacOS/${nodeSidecarName(TRIPLE.macos)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify-deb-launcher.mjs — the CI gate on the REAL .deb
// ─────────────────────────────────────────────────────────────────────────────
const hasDpkg = spawnSync("dpkg-deb", ["--version"]).status === 0;
const verifier = join(root, "scripts/verify-deb-launcher.mjs");

describe.skipIf(skipPosix || !hasDpkg)("verify-deb-launcher.mjs — rejects /usr/bin/node, accepts /usr/bin/slidecraft-node", () => {
  let tmp: string;
  const cliCjs = join(root, "dist/mcp/cli.cjs");
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "slidecraft-527-deb-"));
    if (!existsSync(cliCjs)) execFileSync("npm", ["run", "build:mcp:bundled"], { cwd: root, stdio: "pipe" });
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function buildDeb(name: string, sidecars: string[]): string {
    const pkg = join(tmp, name);
    mkdirSync(join(pkg, "DEBIAN"), { recursive: true });
    writeFileSync(join(pkg, "DEBIAN/control"), "Package: slide-craft\nVersion: 0.0.0\nArchitecture: amd64\nMaintainer: t\nDescription: t\n");
    mkdirSync(join(pkg, `usr/lib/${productName}`), { recursive: true });
    copyFileSync(cliCjs, join(pkg, `usr/lib/${productName}/cli.cjs`));
    for (const s of sidecars) writeFakeNode(join(pkg, "usr/bin", s));
    installLauncher(join(pkg, "usr/bin/slidecraft-mcp"));
    const deb = join(tmp, `${name}.deb`);
    execFileSync("dpkg-deb", ["-Znone", "-b", pkg, deb], { stdio: "pipe" });
    return deb;
  }

  it("passes when the package ships usr/bin/slidecraft-node and no usr/bin/node", () => {
    const r = spawnSync(process.execPath, [verifier, buildDeb("new-layout", ["slidecraft-node"])], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/usr\/bin\/slidecraft-node/);
    expect(r.stdout).toMatch(/serverInfo.*slidecraft/);
  });

  it("fails loudly when the package ships usr/bin/node (conflicts with the system `nodejs` package)", () => {
    const r = spawnSync(process.execPath, [verifier, buildDeb("conflicting", ["slidecraft-node", "node"])], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usr\/bin\/node/);
    expect(r.stderr).toMatch(/nodejs/);
  });

  it("fails loudly on the v0.5.0 layout (usr/bin/node only, no slidecraft-node)", () => {
    const r = spawnSync(process.execPath, [verifier, buildDeb("old-layout", ["node"])], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usr\/bin\/slidecraft-node/);
  });
});
