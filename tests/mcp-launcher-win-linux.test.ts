// Guards the Windows / Linux half of "one word registers the bundled MCP server" (#519, ADR-0022,
// ADR-0038 D5). macOS gets `slidecraft-mcp` on PATH from the Homebrew cask; this file pins down the
// other two OSes: (1) a Windows `.cmd` launcher that resolves the bundled node.exe + cli.cjs relative
// to itself (Tauri's NSIS/WiX put `resources` and `externalBin` sidecars FLAT in the install dir),
// (2) the POSIX launcher ALSO working from the Linux .deb/.rpm/AppImage layout (/usr/bin/slidecraft-mcp
// next to the node sidecar, cli.cjs under /usr/lib/<productName>/), (3) the installer-side PATH wiring
// (NSIS hooks + WiX fragment: USER scope, removed on uninstall, visible in the installer UI), and (4) the
// CI artifact check that proves the built .deb really contains a working /usr/bin/slidecraft-mcp.
//
// The POSIX launcher is exercised for REAL against fake install trees (paths with spaces, Homebrew
// symlink, argument pass-through, exit code). The .cmd / .nsh / .wxs cannot run on Linux, so they are
// pinned by content + agreement tests against the bundle overlay (R8).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  symlinkSync,
  rmSync,
  mkdtempSync,
  realpathSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");

interface Overlay {
  bundle: {
    externalBin: string[];
    resources: Record<string, string>;
    linux?: {
      deb?: { files?: Record<string, string> };
      rpm?: { files?: Record<string, string> };
      appimage?: { files?: Record<string, string> };
    };
    windows?: {
      nsis?: { installerHooks?: string };
      wix?: { fragmentPaths?: string[]; componentRefs?: string[] };
    };
  };
}
const overlay = JSON.parse(read("src-tauri/tauri.bundle.conf.json")) as Overlay;
const productName = (JSON.parse(read("src-tauri/tauri.conf.json")) as { productName: string }).productName;

// ── Effective bundle config per OS (mirrors tauri-cli's load order, #537) ─────────────────────────
// tauri-cli (`crates/tauri-cli/src/helpers/config.rs::load_config`) builds the config as
//   tauri.conf.json  ⊕  tauri.<platform>.conf.json (if present)  ⊕  every `--config` overlay,
// each step a JSON Merge Patch (RFC 7396): objects merge key by key, anything else (arrays included)
// replaces the whole value. The platform file is read unconditionally — `--config` does NOT switch it
// off — so `bundle.resources` (an object) is the union of the common overlay and the platform file.
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const isObj = (v: Json): v is { [k: string]: Json } => typeof v === "object" && v !== null && !Array.isArray(v);
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
function effectiveBundle(platform: Platform): Overlay["bundle"] {
  let conf: Json = JSON.parse(read("src-tauri/tauri.conf.json")) as Json;
  const platformFile = `src-tauri/tauri.${platform}.conf.json`;
  if (existsSync(join(root, platformFile))) conf = mergePatch(conf, JSON.parse(read(platformFile)) as Json);
  conf = mergePatch(conf, overlay as unknown as Json);
  return (conf as unknown as Overlay).bundle;
}

// ─────────────────────────────────────────────────────────────────────────────
// Windows launcher (.cmd) — content (cannot execute on Linux)
// ─────────────────────────────────────────────────────────────────────────────
describe("slidecraft-mcp.cmd — Windows launcher content", () => {
  const cmd = lf(read("scripts/slidecraft-mcp.cmd"));

  it("is a quiet batch file that execs the SIBLING node.exe with the SIBLING cli.cjs and passes all args", () => {
    expect(cmd.trimStart().startsWith("@echo off")).toBe(true);
    // Tauri NSIS: `SetOutPath $INSTDIR` + `File /oname=<target>` for resources AND externalBin → both
    // flat in the install dir. WiX renders {{resources}} under DirectoryRef INSTALLDIR likewise. So the
    // launcher's own folder (%~dp0, trailing backslash) is where node.exe and cli.cjs live.
    expect(cmd).toMatch(/"%~dp0node\.exe"/);
    expect(cmd).toMatch(/"%~dp0cli\.cjs"/);
    expect(cmd).toMatch(/cli\.cjs" %\*/); // argument pass-through, verbatim
    // The Issue text guessed `%~dp0..\node.exe` / a `resources\` subfolder; the bundler source says flat.
    expect(cmd).not.toMatch(/%~dp0\.\./);
    expect(cmd).not.toMatch(/resources\\/i);
  });

  it("falls back to a PATH node only when the sidecar is missing, and never hardcodes an absolute path", () => {
    expect(cmd).toMatch(/if not exist "%~dp0node\.exe"/i);
    expect(cmd).not.toMatch(/[A-Z]:\\/);
  });

  it("agrees with the bundle overlay: cli.cjs is a resource target and node is an externalBin (→ node.exe)", () => {
    expect(Object.values(overlay.bundle.resources)).toContain("cli.cjs");
    expect(overlay.bundle.externalBin.map((b) => basename(b))).toContain("node");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POSIX launcher — real execution against fake install trees
// ─────────────────────────────────────────────────────────────────────────────
const sh = join(root, "scripts/slidecraft-mcp");
const skipPosix = process.platform === "win32";

/** A fake `node` sidecar: records which node ran via an env marker, then execs the real Node so the
 *  fake cli.cjs can run. Lets a test prove the SIDECAR (not a PATH node) was chosen. */
function writeFakeNode(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\nSLIDECRAFT_TEST_NODE="$0" exec "${process.execPath}" "$@"\n`);
  chmodSync(path, 0o755);
}
/** A fake cli.cjs: prints JSON of its argv + which node launched it, exits with a requested code. */
function writeFakeCli(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), node: process.env.SLIDECRAFT_TEST_NODE || "PATH" }));\n` +
      `if (process.env.SLIDECRAFT_TEST_EXIT) process.exit(Number(process.env.SLIDECRAFT_TEST_EXIT));\n`,
  );
}
function installLauncher(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(sh, path);
  chmodSync(path, 0o755);
}
interface Run {
  status: number | null;
  out: { argv: string[]; node: string } | null;
  stderr: string;
}
function run(launcher: string, args: string[], env: Record<string, string> = {}): Run {
  const r = spawnSync(launcher, args, { encoding: "utf8", env: { ...process.env, ...env } });
  let out: Run["out"];
  try {
    out = JSON.parse(r.stdout) as Run["out"];
  } catch {
    out = null;
  }
  return { status: r.status, out, stderr: r.stderr };
}

describe.skipIf(skipPosix)("slidecraft-mcp (sh) — resolves the bundled node + cli.cjs from every shipped layout", () => {
  let tmp: string;
  beforeAll(() => {
    // A space in the root dir exercises every unquoted-path bug at once.
    tmp = mkdtempSync(join(tmpdir(), "slidecraft launcher "));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("Linux .deb/.rpm layout: /usr/bin/slidecraft-mcp → sibling /usr/bin/node + /usr/lib/<productName>/cli.cjs", () => {
    const r = join(tmp, "deb root");
    installLauncher(join(r, "usr/bin/slidecraft-mcp"));
    writeFakeNode(join(r, "usr/bin/node"));
    writeFakeCli(join(r, `usr/lib/${productName}/cli.cjs`));
    const res = run(join(r, "usr/bin/slidecraft-mcp"), ["--root", "/tmp/with space", "a b", "--flag"]);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    expect(res.out?.argv).toEqual(["--root", "/tmp/with space", "a b", "--flag"]);
    expect(res.out?.node).toBe(join(r, "usr/bin/node")); // the SIDECAR, not a PATH node
  });

  it("Linux resource copy: /usr/lib/<productName>/slidecraft-mcp also works (node via ../../bin/node)", () => {
    const r = join(tmp, "deb root 2");
    installLauncher(join(r, `usr/lib/${productName}/slidecraft-mcp`));
    writeFakeNode(join(r, "usr/bin/node"));
    writeFakeCli(join(r, `usr/lib/${productName}/cli.cjs`));
    const res = run(join(r, `usr/lib/${productName}/slidecraft-mcp`), ["x"]);
    expect(res.status).toBe(0);
    expect(res.out?.argv).toEqual(["x"]);
    expect(realpathSync(res.out!.node)).toBe(realpathSync(join(r, "usr/bin/node"))); // reached via ../../bin/node
  });

  it("macOS layout through the Homebrew bin symlink: Contents/MacOS/node + Contents/Resources/cli.cjs (unchanged)", () => {
    const r = join(tmp, "mac root");
    const app = join(r, "Applications/SlideCraft.app/Contents");
    installLauncher(join(app, "Resources/slidecraft-mcp"));
    writeFakeNode(join(app, "MacOS/node"));
    writeFakeCli(join(app, "Resources/cli.cjs"));
    mkdirSync(join(r, "homebrew/bin"), { recursive: true });
    // Homebrew's `binary` stanza installs a RELATIVE symlink; the launcher must follow it to the .app.
    symlinkSync("../../Applications/SlideCraft.app/Contents/Resources/slidecraft-mcp", join(r, "homebrew/bin/slidecraft-mcp"));
    const res = run(join(r, "homebrew/bin/slidecraft-mcp"), ["--root", "/x y"]);
    expect(res.status).toBe(0);
    expect(res.out?.argv).toEqual(["--root", "/x y"]);
    expect(realpathSync(res.out!.node)).toBe(realpathSync(join(app, "MacOS/node")));
  });

  it("falls back to a PATH node only when no sidecar exists next to the layout", () => {
    const r = join(tmp, "no sidecar");
    installLauncher(join(r, "usr/bin/slidecraft-mcp"));
    writeFakeCli(join(r, `usr/lib/${productName}/cli.cjs`));
    const pathDir = join(tmp, "path node");
    writeFakeNode(join(pathDir, "node"));
    const res = run(join(r, "usr/bin/slidecraft-mcp"), [], { PATH: `${pathDir}:${process.env.PATH ?? ""}` });
    expect(res.status).toBe(0);
    expect(res.out?.node).toBe(join(pathDir, "node"));
  });

  it("propagates the server's exit code (exec, no wrapper shell left behind)", () => {
    const r = join(tmp, "exit code");
    installLauncher(join(r, "usr/bin/slidecraft-mcp"));
    writeFakeNode(join(r, "usr/bin/node"));
    writeFakeCli(join(r, `usr/lib/${productName}/cli.cjs`));
    const res = run(join(r, "usr/bin/slidecraft-mcp"), [], { SLIDECRAFT_TEST_EXIT: "7" });
    expect(res.status).toBe(7);
  });

  it("agreement: the Linux resource dir the launcher assumes is Tauri's /usr/lib/<productName>", () => {
    // Tauri bundler (debian.rs / rpm.rs): resources → /usr/lib/<product_name>/; the v0.5.0 .deb has
    // usr/lib/SlideCraft/cli.cjs. If productName ever changes, this must change with it.
    expect(lf(read("scripts/slidecraft-mcp"))).toContain(`lib/${productName}/cli.cjs`);
    expect(lf(read("scripts/slidecraft-mcp"))).toContain("MacOS/node"); // macOS path is untouched
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bundle overlay wiring (Tauri v2 config) — one place ships the launcher on every OS
// ─────────────────────────────────────────────────────────────────────────────
describe("tauri.bundle.conf.json — ships the launchers and the installer PATH wiring", () => {
  it("the common overlay carries the .cmd launcher next to cli.cjs, and NOT the POSIX sh launcher (#537)", () => {
    // The sh launcher used to sit here too, so Windows installs got an extension-less `slidecraft-mcp`
    // FIRST on PATH (`where slidecraft-mcp` → sh file, then .cmd). It now lives in the macOS platform file.
    expect(overlay.bundle.resources["../scripts/slidecraft-mcp.cmd"]).toBe("slidecraft-mcp.cmd");
    expect(overlay.bundle.resources["../dist/mcp/cli.cjs"]).toBe("cli.cjs");
    expect(overlay.bundle.resources["../scripts/slidecraft-mcp"]).toBeUndefined();
    expect(Object.values(overlay.bundle.resources)).not.toContain("slidecraft-mcp");
  });

  it("tauri.macos.conf.json (auto-merged platform config) is where the sh launcher ships for the cask", () => {
    const mac = JSON.parse(read("src-tauri/tauri.macos.conf.json")) as Overlay;
    expect(mac.bundle.resources["../scripts/slidecraft-mcp"]).toBe("slidecraft-mcp");
    // Only the launcher — everything else stays in the common overlay so the two never disagree.
    expect(Object.keys(mac.bundle.resources)).toEqual(["../scripts/slidecraft-mcp"]);
  });

  it("effective Windows resources: cli.cjs, host.cjs and the .cmd — no extension-less sh file on PATH", () => {
    const res = effectiveBundle("windows").resources;
    expect(Object.values(res)).toContain("slidecraft-mcp.cmd");
    expect(Object.values(res)).toContain("cli.cjs");
    expect(Object.values(res)).toContain("host.cjs");
    expect(Object.values(res)).not.toContain("slidecraft-mcp");
    expect(res["../scripts/slidecraft-mcp"]).toBeUndefined();
  });

  it("effective macOS resources still include Contents/Resources/slidecraft-mcp (cask `binary` stanza, ADR-0022)", () => {
    const res = effectiveBundle("macos").resources;
    expect(res["../scripts/slidecraft-mcp"]).toBe("slidecraft-mcp");
    expect(res["../dist/mcp/cli.cjs"]).toBe("cli.cjs"); // the platform file ADDS to, never replaces, the overlay
    expect(res["../scripts/slidecraft-mcp.cmd"]).toBe("slidecraft-mcp.cmd");
  });

  it("effective Linux resources drop the sh copy; /usr/bin/slidecraft-mcp comes from bundle.linux.*.files instead", () => {
    const b = effectiveBundle("linux");
    expect(Object.values(b.resources)).not.toContain("slidecraft-mcp");
    expect(b.linux?.deb?.files?.["/usr/bin/slidecraft-mcp"]).toBe("../scripts/slidecraft-mcp");
  });

  it("agreement (R8): the macOS platform file points at the SAME script the cask + Linux packages ship", () => {
    const mac = JSON.parse(read("src-tauri/tauri.macos.conf.json")) as Overlay;
    const [src, dst] = Object.entries(mac.bundle.resources)[0];
    expect(existsSync(join(root, "src-tauri", src))).toBe(true);
    expect(dst).toBe("slidecraft-mcp");
    expect(read("packaging/homebrew/Casks/slidecraft.rb")).toContain(`Contents/Resources/${dst}`);
    expect(overlay.bundle.linux?.deb?.files?.["/usr/bin/slidecraft-mcp"]).toBe(src);
  });

  it("deb / rpm / AppImage install the POSIX launcher as /usr/bin/slidecraft-mcp (on PATH by construction)", () => {
    for (const kind of ["deb", "rpm", "appimage"] as const) {
      const files = overlay.bundle.linux?.[kind]?.files;
      expect(files, `bundle.linux.${kind}.files`).toBeDefined();
      expect(files?.["/usr/bin/slidecraft-mcp"]).toBe("../scripts/slidecraft-mcp");
    }
  });

  it("NSIS installerHooks and WiX fragment files exist where the overlay points (paths relative to src-tauri)", () => {
    const hooks = overlay.bundle.windows?.nsis?.installerHooks;
    expect(hooks).toBeTruthy();
    expect(existsSync(join(root, "src-tauri", hooks!))).toBe(true);
    const frags = overlay.bundle.windows?.wix?.fragmentPaths ?? [];
    expect(frags.length).toBeGreaterThan(0);
    for (const f of frags) expect(existsSync(join(root, "src-tauri", f)), f).toBe(true);
  });

  it("agreement: every wix.componentRefs id is a <Component Id> in the fragments, and vice versa", () => {
    const refs = overlay.bundle.windows?.wix?.componentRefs ?? [];
    const ids = (overlay.bundle.windows?.wix?.fragmentPaths ?? []).flatMap((f) =>
      [...read(join("src-tauri", f)).matchAll(/<Component\s+Id="([^"]+)"/g)].map((m) => m[1]),
    );
    expect(refs.length).toBeGreaterThan(0);
    expect([...refs].sort()).toEqual([...ids].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NSIS installer hooks — user PATH, reversible, visible, fail-safe
// ─────────────────────────────────────────────────────────────────────────────
describe("slidecraft-mcp-path.nsh — NSIS hooks", () => {
  // Code only: NSIS `;` comments stripped, so the prose ("never HKLM") cannot mask or fake an instruction.
  const nsh = lf(read("src-tauri/windows/slidecraft-mcp-path.nsh"))
    .split("\n")
    .map((l) => l.replace(/\s;.*$/, "").replace(/^\s*;.*$/, ""))
    .join("\n");

  it("adds on POSTINSTALL (after resources exist) and removes on PREUNINSTALL (before they are deleted)", () => {
    expect(nsh).toMatch(/^!macro NSIS_HOOK_POSTINSTALL\s*$/m);
    expect(nsh).toMatch(/^!macro NSIS_HOOK_PREUNINSTALL\s*$/m);
  });

  it("touches ONLY the user-scope PATH (HKCU\\Environment) and preserves REG_EXPAND_SZ", () => {
    expect(nsh).toMatch(/ReadRegStr\s+\$\w+\s+HKCU\s+"Environment"\s+"Path"/);
    expect(nsh).toMatch(/WriteRegExpandStr\s+HKCU\s+"Environment"\s+"Path"/);
    expect(nsh).not.toMatch(/HKLM/);
    expect(nsh).not.toMatch(/WriteRegStr\s+HKCU\s+"Environment"/); // would downgrade to REG_SZ
  });

  it("broadcasts the environment change so new shells see the PATH without a logoff", () => {
    expect(nsh).toMatch(/SendMessage\s+\$\{HWND_BROADCAST\}\s+\$\{WM_(WININICHANGE|SETTINGCHANGE)\}\s+0\s+"STR:Environment"/);
  });

  it("is never silent: DetailPrint in both hooks, and any MessageBox has a silent-mode default (/SD)", () => {
    const post = nsh.slice(nsh.indexOf("!macro NSIS_HOOK_POSTINSTALL"), nsh.indexOf("!macroend", nsh.indexOf("!macro NSIS_HOOK_POSTINSTALL")));
    const pre = nsh.slice(nsh.indexOf("!macro NSIS_HOOK_PREUNINSTALL"), nsh.indexOf("!macroend", nsh.indexOf("!macro NSIS_HOOK_PREUNINSTALL")));
    expect(post).toMatch(/DetailPrint/);
    expect(pre).toMatch(/DetailPrint/);
    for (const line of nsh.split("\n").filter((l) => /^\s*MessageBox\b/.test(l))) expect(line).toMatch(/\/SD\s+ID\w+/);
  });

  it("refuses (instead of truncating) a PATH that does not fit NSIS's string registers", () => {
    expect(nsh).toMatch(/NSIS_MAX_STRLEN/);
    expect(nsh).toMatch(/StrLen/);
  });

  it("is idempotent: strips an existing entry before appending, so reinstall/update never duplicates", () => {
    expect(nsh).toMatch(/WordReplace/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WiX (MSI) fragment — the declarative equivalent, handled by Windows Installer
// ─────────────────────────────────────────────────────────────────────────────
describe("slidecraft-mcp-path.wxs — WiX fragment", () => {
  const wxs = read("src-tauri/windows/slidecraft-mcp-path.wxs");

  it("is well-formed enough: WiX3 namespace, balanced tags, one Fragment under INSTALLDIR", () => {
    expect(wxs).toContain('xmlns="http://schemas.microsoft.com/wix/2006/wi"');
    expect(wxs).toMatch(/<DirectoryRef\s+Id="INSTALLDIR"/);
    // Balanced-tag check (no XML parser in the node test env): every opened element is closed.
    const opens = [...wxs.matchAll(/<([A-Za-z]+)\b[^>]*?(?<!\/)>/g)].map((m) => m[1]);
    const closes = [...wxs.matchAll(/<\/([A-Za-z]+)>/g)].map((m) => m[1]);
    expect(opens.sort()).toEqual(closes.sort());
  });

  it("appends [INSTALLDIR] to the USER PATH, non-permanent (removed on uninstall)", () => {
    const env = wxs.match(/<Environment\b[^>]*\/>/)?.[0] ?? "";
    expect(env).toContain('Name="PATH"');
    expect(env).toContain('Value="[INSTALLDIR]"');
    expect(env).toContain('System="no"'); // user scope — never the machine PATH
    expect(env).toContain('Permanent="no"'); // uninstall removes it
    expect(env).toContain('Part="last"');
    expect(env).toContain('Action="set"');
  });

  it("gives the per-user component an HKCU registry KeyPath (MSI rule for user-profile components)", () => {
    const reg = wxs.match(/<RegistryValue\b[^>]*\/>/)?.[0] ?? "";
    expect(reg).toContain('Root="HKCU"');
    expect(reg).toContain('KeyPath="yes"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CI artifact check — the built .deb really contains a WORKING /usr/bin/slidecraft-mcp
// ─────────────────────────────────────────────────────────────────────────────
const hasDpkg = spawnSync("dpkg-deb", ["--version"]).status === 0;
const verifier = join(root, "scripts/verify-deb-launcher.mjs");

describe.skipIf(skipPosix || !hasDpkg)("verify-deb-launcher.mjs — inspects a .deb and runs its launcher", () => {
  let tmp: string;
  const cliCjs = join(root, "dist/mcp/cli.cjs");

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "slidecraft-deb-"));
    if (!existsSync(cliCjs)) execFileSync("npm", ["run", "build:mcp:bundled"], { cwd: root, stdio: "pipe" });
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  /** Build a minimal .deb with the Tauri Linux layout (real cli.cjs, a `node` that is this Node). */
  function buildDeb(name: string, opts: { launcher: boolean }): string {
    const pkg = join(tmp, name);
    mkdirSync(join(pkg, "DEBIAN"), { recursive: true });
    writeFileSync(join(pkg, "DEBIAN/control"), "Package: slide-craft\nVersion: 0.0.0\nArchitecture: amd64\nMaintainer: t\nDescription: t\n");
    mkdirSync(join(pkg, "usr/bin"), { recursive: true });
    mkdirSync(join(pkg, `usr/lib/${productName}`), { recursive: true });
    copyFileSync(cliCjs, join(pkg, `usr/lib/${productName}/cli.cjs`));
    writeFakeNode(join(pkg, "usr/bin/node"));
    if (opts.launcher) installLauncher(join(pkg, "usr/bin/slidecraft-mcp"));
    const deb = join(tmp, `${name}.deb`);
    execFileSync("dpkg-deb", ["-Znone", "-b", pkg, deb], { stdio: "pipe" });
    return deb;
  }

  it("passes on a .deb whose /usr/bin/slidecraft-mcp answers MCP initialize via the bundled node", () => {
    const deb = buildDeb("good", { launcher: true });
    const r = spawnSync(process.execPath, [verifier, deb], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/usr\/bin\/slidecraft-mcp/);
    expect(r.stdout).toMatch(/serverInfo.*slidecraft/);
  });

  it("fails loudly on a .deb that lacks /usr/bin/slidecraft-mcp (the pre-#519 layout)", () => {
    const deb = buildDeb("bad", { launcher: false });
    const r = spawnSync(process.execPath, [verifier, deb], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usr\/bin\/slidecraft-mcp/);
  });
});

describe("ci.yml — the Linux smoke builds the REAL overlay and inspects the .deb", () => {
  const ci = read(".github/workflows/ci.yml");
  const build = ci.slice(ci.indexOf("\n  build:"), ci.indexOf("\n  browser-smoke:"));

  it("stages both sidecars, builds with the bundle overlay, then runs verify-deb-launcher.mjs", () => {
    expect(build).toMatch(/stage-node\.mjs x86_64-unknown-linux-gnu/);
    expect(build).toMatch(/stage-llamafile\.mjs x86_64-unknown-linux-gnu/);
    expect(build).toMatch(/--config src-tauri\/tauri\.bundle\.conf\.json/);
    expect(build).toMatch(/verify-deb-launcher\.mjs/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Docs — Windows/Linux are no longer "unverified / follow-up"
// ─────────────────────────────────────────────────────────────────────────────
describe("docs — Windows/Linux registration is documented as the one-word launcher", () => {
  it("docs/mcp-server.md no longer defers the Windows/Linux launcher to a follow-up", () => {
    const md = read("docs/mcp-server.md");
    expect(md).not.toMatch(/PATH ランチャ.*follow-up/);
    expect(md).toMatch(/slidecraft-mcp\.cmd/);
    expect(md).toMatch(/\/usr\/bin\/slidecraft-mcp/);
  });
});
