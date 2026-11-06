// verify-deb-launcher.mjs — prove a built Linux package REALLY ships a working `slidecraft-mcp` (#519).
//
//   node scripts/verify-deb-launcher.mjs <path/to/SlideCraft_*.deb> [<path/to/*.AppImage>]
//
// Why a script instead of trusting the config: `bundle.linux.deb.files` is declarative, and a typo there
// (or a Tauri layout change — see the v0.5.0 .deb that had NO /usr/bin launcher) would only surface
// when a user runs `claude mcp add`. So CI's Linux smoke extracts the artifact and checks, for each
// package handed to it:
//   1. usr/bin/slidecraft-mcp exists and is executable (the PATH launcher),
//   2. usr/bin/node (bundled Node sidecar) and usr/lib/<productName>/cli.cjs (bundled MCP server) exist,
//   3. the launcher, run from the extracted tree with NO system Node, answers an MCP `initialize`
//      request over stdio with serverInfo.name === "slidecraft" — i.e. the relative path resolution in
//      scripts/slidecraft-mcp holds for the layout Tauri actually produced.
// Exit code 0 = all packages OK; 1 = a check failed (printed on stderr, never silent).
// No npm deps: runs on a bare CI runner / dev box with dpkg-deb (and an AppImage's own --appimage-extract).
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const productName = JSON.parse(readFileSync(join(here, "..", "src-tauri", "tauri.conf.json"), "utf8")).productName;

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/verify-deb-launcher.mjs <package.deb> [<app.AppImage>] ...");
  process.exit(2);
}

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`FAIL: ${msg}`);
};

/** Extract a package into a scratch dir and return the root that contains `usr/`. */
function extract(pkg, scratch) {
  if (pkg.endsWith(".deb")) {
    execFileSync("dpkg-deb", ["-x", pkg, scratch], { stdio: "pipe" });
    return scratch;
  }
  if (pkg.endsWith(".AppImage")) {
    // --appimage-extract needs no FUSE; it writes ./squashfs-root in the cwd.
    chmodSync(pkg, 0o755);
    execFileSync(pkg, ["--appimage-extract"], { cwd: scratch, stdio: "pipe" });
    return join(scratch, "squashfs-root");
  }
  throw new Error(`unsupported package type: ${pkg}`);
}

/** A `node` that fails loudly, placed FIRST on PATH: proves the launcher used the bundled sidecar and
 *  not whatever Node the runner happens to have (the launcher's PATH fallback must stay a last resort). */
function poisonPath(scratch) {
  const dir = join(scratch, "poison-path");
  mkdirSync(dir, { recursive: true });
  const shim = join(dir, "node");
  writeFileSync(shim, '#!/bin/sh\necho "verify-deb-launcher: the launcher fell back to a PATH node instead of the bundled sidecar" >&2\nexit 97\n');
  chmodSync(shim, 0o755);
  return `${dir}:${process.env.PATH ?? "/usr/bin:/bin"}`;
}

/** Spawn the launcher from the extracted tree, send JSON-RPC initialize, resolve with the reply. */
function initialize(launcher, scratch) {
  return new Promise((done) => {
    const child = spawn(launcher, [], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PATH: poisonPath(scratch) } });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      done({ reply: null, stderr: err + "\n(timeout after 20s)" });
    }, 20_000);
    child.stdout.on("data", (d) => {
      out += d.toString();
      const line = out.split("\n").find((l) => l.trim().startsWith("{"));
      if (line) {
        clearTimeout(timer);
        child.kill();
        try {
          done({ reply: JSON.parse(line), stderr: err });
        } catch {
          done({ reply: null, stderr: err + `\n(unparseable stdout: ${line.slice(0, 200)})` });
        }
      }
    });
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ reply: null, stderr: err + `\n(spawn error: ${e.message})` });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (!out.includes("{")) done({ reply: null, stderr: err + `\n(exited ${code} before replying)` });
    });
    const req = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-deb-launcher", version: "0" } },
    };
    child.stdin.write(JSON.stringify(req) + "\n");
  });
}

for (const arg of args) {
  const pkg = resolve(arg);
  console.log(`\n== ${pkg}`);
  if (!existsSync(pkg)) {
    fail(`package not found: ${pkg}`);
    continue;
  }
  const scratch = mkdtempSync(join(tmpdir(), "slidecraft-verify-"));
  try {
    const root = extract(pkg, scratch);
    const launcher = join(root, "usr/bin/slidecraft-mcp");
    const node = join(root, "usr/bin/node");
    const cli = join(root, `usr/lib/${productName}/cli.cjs`);
    for (const [label, p, exec] of [
      ["PATH launcher", launcher, true],
      ["bundled node sidecar", node, true],
      ["bundled MCP server", cli, false],
    ]) {
      if (!existsSync(p)) {
        fail(`${label} missing: ${p.replace(root, "")}`);
        continue;
      }
      const mode = statSync(p).mode & 0o111;
      if (exec && mode === 0) fail(`${label} is not executable: ${p.replace(root, "")}`);
      console.log(`ok  ${label}: ${p.replace(root, "")}${exec ? ` (mode ${(statSync(p).mode & 0o777).toString(8)})` : ""}`);
    }
    if (existsSync(launcher) && existsSync(node) && existsSync(cli)) {
      const { reply, stderr } = await initialize(launcher, scratch);
      const name = reply?.result?.serverInfo?.name;
      if (name === "slidecraft") {
        console.log(`ok  usr/bin/slidecraft-mcp answered initialize: serverInfo.name=${name} (stderr: ${stderr.trim().split("\n")[0] || "-"})`);
      } else {
        fail(`usr/bin/slidecraft-mcp did not answer MCP initialize with serverInfo.name=slidecraft\n  reply: ${JSON.stringify(reply)?.slice(0, 300)}\n  stderr: ${stderr.trim()}`);
      }
    }
  } catch (e) {
    fail(`${pkg}: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (failed) {
  console.error("\nverify-deb-launcher: FAILED — the Linux package does not ship a working slidecraft-mcp (#519).");
  process.exit(1);
}
console.log("\nverify-deb-launcher: OK");
