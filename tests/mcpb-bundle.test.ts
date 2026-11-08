// #517 子 3 — the Claude Desktop bundle (`.mcpb`: a zip of manifest.json + the server, installed by
// double-click). One bundle per OS Claude Desktop ships on (macOS arm64 / Windows x64), each carrying the
// bundled Node runtime (ADR-0022: no system Node, and no reliance on whatever Node Claude Desktop ships)
// plus the self-contained cli.cjs.
//
// Pinned here: the manifest validates against the OFFICIAL schema (@anthropic-ai/mcpb, the same package
// release.yml packs with), the file list, the asset name (shared with the GUI's download link — R8), the
// staged-node source path (shared with stage-node.mjs / node-sidecar.mjs — R8), and the release wiring.
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MANIFEST_SCHEMAS } from "@anthropic-ai/mcpb";
import {
  MCPB_MANIFEST_VERSION, MCPB_TARGETS, buildMcpbManifest, mcpbAssetName, mcpbFiles, mcpbTargetForTriple, stagedNodePath,
} from "../scripts/mcpb-manifest.mjs";
import { nodeSidecarName } from "../scripts/node-sidecar.mjs";
import { mcpbAssetNameFor } from "../src/ipc/mcpb-asset";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const appVersion = (JSON.parse(read("src-tauri/tauri.conf.json")) as { version: string }).version;

describe("buildMcpbManifest — a valid MCPB manifest per target", () => {
  it.each(Object.keys(MCPB_TARGETS))("%s: validates against the official @anthropic-ai/mcpb schema", (target) => {
    const m = buildMcpbManifest(target, appVersion);
    const parsed = MANIFEST_SCHEMAS[MCPB_MANIFEST_VERSION].safeParse(m);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("runs the BUNDLED node on the bundled cli.cjs (binary type — not Claude Desktop's own Node)", () => {
    const m = buildMcpbManifest("win32-x64", appVersion);
    expect(m.manifest_version).toBe("0.3");
    expect(m.name).toBe("slidecraft"); // the same one-word server name as `claude mcp add slidecraft` (ADR-0038 D5)
    expect(m.version).toBe(appVersion);
    expect(m.server).toEqual({
      type: "binary",
      entry_point: "server/node",
      // No `.exe`: the Windows bundle ships server/node.exe and the spawn resolves the extension; the same
      // spelling on both OSes keeps one manifest shape (see scripts/mcpb-manifest.mjs).
      mcp_config: { command: "${__dirname}/server/node", args: ["${__dirname}/server/cli.cjs"] },
    });
    // --no-fs stays the default (no --root in args) — Issue #517 invariant.
    expect(m.server.mcp_config.args).not.toContain("--root");
  });

  it("each bundle declares only its own platform", () => {
    expect(buildMcpbManifest("darwin-arm64", appVersion).compatibility).toEqual({ platforms: ["darwin"] });
    expect(buildMcpbManifest("win32-x64", appVersion).compatibility).toEqual({ platforms: ["win32"] });
  });

  it("refuses an unknown target or an empty version (never-silent)", () => {
    expect(() => buildMcpbManifest("linux-x64", appVersion)).toThrow(/linux-x64/);
    expect(() => buildMcpbManifest("darwin-arm64", "")).toThrow(/version/);
  });
});

describe("mcpbFiles — what goes into the zip", () => {
  it("darwin-arm64: manifest, icon, cli.cjs and the staged node", () => {
    expect(mcpbFiles("darwin-arm64")).toEqual([
      { from: "src-tauri/icons/icon.png", to: "icon.png" },
      { from: "dist/mcp/cli.cjs", to: "server/cli.cjs" },
      { from: "src-tauri/binaries/node-aarch64-apple-darwin", to: "server/node" },
    ]);
  });
  it("win32-x64: the node is node.exe", () => {
    expect(mcpbFiles("win32-x64")).toEqual([
      { from: "src-tauri/icons/icon.png", to: "icon.png" },
      { from: "dist/mcp/cli.cjs", to: "server/cli.cjs" },
      { from: "src-tauri/binaries/node-x86_64-pc-windows-msvc.exe", to: "server/node.exe" },
    ]);
  });
  it("R8: the staged node path uses node-sidecar.mjs's name rule (the file stage-node.mjs writes)", () => {
    for (const [target, { triple }] of Object.entries(MCPB_TARGETS)) {
      const ext = triple.includes("windows") ? ".exe" : "";
      expect(stagedNodePath(target)).toBe(`src-tauri/binaries/${nodeSidecarName(triple)}-${triple}${ext}`);
    }
  });
  it("the manifest's icon and entry point are files the bundle actually contains", () => {
    for (const target of Object.keys(MCPB_TARGETS)) {
      const m = buildMcpbManifest(target, appVersion);
      const to = mcpbFiles(target).map((f) => f.to);
      expect(to).toContain(m.icon);
      expect(to.some((p) => p === m.server.entry_point || p === `${m.server.entry_point}.exe`)).toBe(true);
    }
  });
});

describe("targets and asset names", () => {
  it("maps release triples to bundles; Linux has no Claude Desktop → no bundle", () => {
    expect(mcpbTargetForTriple("aarch64-apple-darwin")).toBe("darwin-arm64");
    expect(mcpbTargetForTriple("x86_64-pc-windows-msvc")).toBe("win32-x64");
    expect(mcpbTargetForTriple("x86_64-unknown-linux-gnu")).toBeNull();
  });
  it("asset names carry no version, so the GUI can name the file without knowing the release", () => {
    expect(mcpbAssetName("darwin-arm64")).toBe("slidecraft-darwin-arm64.mcpb");
    expect(mcpbAssetName("win32-x64")).toBe("slidecraft-win32-x64.mcpb");
  });
  it("R8: the GUI looks for exactly the asset the release uploads", () => {
    expect(mcpbAssetNameFor("macos")).toBe(mcpbAssetName("darwin-arm64"));
    expect(mcpbAssetNameFor("windows")).toBe(mcpbAssetName("win32-x64"));
    expect(mcpbAssetNameFor("linux")).toBeNull();
  });
});

describe("scripts/build-mcpb.mjs — stages the bundle directory", () => {
  it("writes manifest.json + every listed file under dist/mcpb/<target>, keeping node executable", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mcpb-stage-"));
    try {
      // A fake repo root: just the inputs the script reads.
      for (const f of mcpbFiles("darwin-arm64")) {
        mkdirSync(dirname(join(tmp, f.from)), { recursive: true });
        writeFileSync(join(tmp, f.from), `fake ${f.to}`, { mode: 0o755 });
      }
      mkdirSync(join(tmp, "src-tauri"), { recursive: true });
      writeFileSync(join(tmp, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "9.8.7" }));
      const r = spawnSync(process.execPath, [join(root, "scripts/build-mcpb.mjs"), "darwin-arm64", "--root", tmp], { encoding: "utf8" });
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      const stage = join(tmp, "dist/mcpb/darwin-arm64");
      expect(JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8"))).toEqual(buildMcpbManifest("darwin-arm64", "9.8.7"));
      for (const f of mcpbFiles("darwin-arm64")) expect(readFileSync(join(stage, f.to), "utf8")).toBe(`fake ${f.to}`);
      expect(statSync(join(stage, "server/node")).mode & 0o111).not.toBe(0);
      expect(r.stdout.trim()).toBe(stage);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails loudly (exit 1, names the file) when an input is missing — e.g. node not staged", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mcpb-stage-"));
    try {
      mkdirSync(join(tmp, "src-tauri"), { recursive: true });
      writeFileSync(join(tmp, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "9.8.7" }));
      const r = spawnSync(process.execPath, [join(root, "scripts/build-mcpb.mjs"), "win32-x64", "--root", tmp], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/src-tauri\/icons\/icon\.png/);
      expect(existsSync(join(tmp, "dist/mcpb/win32-x64/manifest.json"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("release.yml wiring", () => {
  const yml = read(".github/workflows/release.yml");
  it("macOS/Windows legs stage, pack (lockfile-pinned official packer) and upload the .mcpb to the draft", () => {
    expect(yml).toMatch(/mcpb: darwin-arm64/);
    expect(yml).toMatch(/mcpb: win32-x64/);
    expect(yml).toMatch(/node scripts\/build-mcpb\.mjs \$\{\{ matrix\.mcpb \}\}/);
    expect(yml).toMatch(/npx --no-install mcpb pack/);
    expect(yml).toMatch(/gh release upload[^\n]*\.mcpb/);
  });
  it("the Linux leg builds no bundle", () => {
    const linuxLeg = yml.slice(yml.indexOf("- platform: ubuntu-latest"), yml.indexOf("- platform: windows-latest"));
    expect(linuxLeg).toMatch(/mcpb: ""/);
  });
  it("SHA256SUMS covers the .mcpb assets too", () => {
    expect(yml).toMatch(/-p '\*\.mcpb'/);
  });
});
