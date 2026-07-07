// Guards the "bundle the MCP CLI into the app" contract (ADR-0022): an upstream agent must be able to
// drive a PACKAGED SlideCraft install with no source build and no system Node. That requires (1) a
// SELF-CONTAINED cli.cjs (all deps inlined — unlike the dev `build:mcp` which externalizes
// node_modules), (2) it shipped as a bundle resource, (3) wired into beforeBuildCommand, and (4) a
// PATH launcher that finds the bundled node + cli.cjs through Homebrew's symlink.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// The subset of a JSON-RPC `initialize` reply we assert on.
interface InitResponse {
  result?: { serverInfo?: { name?: string }; capabilities?: Record<string, unknown> };
}

describe("MCP CLI bundling — config consistency", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

  it("build:mcp:bundled produces a self-contained cli.cjs (no --packages=external)", () => {
    const s = pkg.scripts["build:mcp:bundled"];
    expect(s, "build:mcp:bundled script must exist").toBeTruthy();
    expect(s).toContain("dist/mcp/cli.cjs");
    expect(s).toContain("--format=cjs");
    // The whole point: deps are INLINED so the app needs no node_modules. --packages=external would
    // reintroduce runtime requires that break in the bundle.
    expect(s).not.toContain("--packages=external");
  });

  it("beforeBuildCommand builds the bundled CLI so the resource exists before packaging", () => {
    const conf = JSON.parse(read("src-tauri/tauri.conf.json")) as { build: { beforeBuildCommand: string } };
    expect(conf.build.beforeBuildCommand).toContain("build:mcp:bundled");
  });

  it("the bundle overlay ships cli.cjs and the launcher as resources", () => {
    const overlay = JSON.parse(read("src-tauri/tauri.bundle.conf.json")) as {
      bundle: { resources: Record<string, string> };
    };
    const res = overlay.bundle.resources;
    expect(res["../dist/mcp/cli.cjs"]).toBe("cli.cjs");
    expect(res["../scripts/slidecraft-mcp"]).toBe("slidecraft-mcp");
  });

  it("the launcher execs the bundled node + cli.cjs and survives the Homebrew symlink", () => {
    const wrapper = read("scripts/slidecraft-mcp");
    expect(wrapper).toContain("cli.cjs");
    expect(wrapper).toContain("MacOS/node"); // bundled node, sibling of Resources
    expect(wrapper).toContain('while [ -h "$target" ]'); // follows the brew bin symlink to the real app
    expect(wrapper).toMatch(/exec .*node.* .*cli/);
  });
});

describe("MCP CLI bundling — Homebrew cask + release safety (adversarial-review regressions)", () => {
  const cask = read("packaging/homebrew/Casks/slidecraft.rb");

  it("puts the launcher on PATH via a binary stanza", () => {
    expect(cask).toMatch(/binary\s+["'][^"']*slidecraft-mcp["']/);
  });

  it("does NOT use set_permissions (not a valid postflight method) — uses system_command chmod", () => {
    expect(cask).not.toContain("set_permissions");
    expect(cask).toMatch(/system_command\s+["']\/bin\/chmod["']/);
  });

  it("update-cask.mjs refuses to pair the launcher stanza with a pre-v0.1.1 version", () => {
    const upd = read("scripts/update-cask.mjs");
    // The fail-closed guard must exist so a v0.1.0 .dmg (no wrapper) can never get the binary stanza.
    expect(upd).toContain("MIN_LAUNCHER_VERSION");
    expect(upd).toMatch(/slidecraft-mcp/); // detects the stanza it is guarding against
  });
});

describe("MCP CLI bundling — the bundled server actually runs standalone", () => {
  const out = join(root, "dist/mcp/cli.cjs");

  beforeAll(() => {
    // Build the real artifact via the real script so we test what ships, not a re-derived command.
    execFileSync("npm", ["run", "build:mcp:bundled"], { cwd: root, stdio: "pipe" });
    expect(existsSync(out)).toBe(true);
  });

  it("starts with a bare node (no node_modules resolution) and answers MCP initialize", async () => {
    const { stderr, response } = await runInitialize(out);
    // The failure mode we're guarding: an externalized dep would crash the process before any reply.
    expect(stderr).not.toMatch(/Cannot find module|MODULE_NOT_FOUND/);
    expect(response?.result?.serverInfo?.name).toBe("slidecraft");
    expect(Object.keys(response?.result?.capabilities ?? {})).toEqual(
      expect.arrayContaining(["tools", "resources"]),
    );
  });
});

// Spawn `node <cliCjs>` in a scratch cwd (proving it does NOT lean on the repo's node_modules), send a
// JSON-RPC initialize over stdio, and resolve with the first JSON reply + collected stderr.
function runInitialize(cliCjs: string): Promise<{ stderr: string; response: InitResponse | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliCjs], { cwd: dirname(cliCjs), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ stderr: err, response: parseFirstJson(out) });
    }, 4000);
    child.stdout.on("data", (d) => {
      out += d;
      if (parseFirstJson(out)) {
        clearTimeout(timer);
        child.kill();
        resolve({ stderr: err, response: parseFirstJson(out) });
      }
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    const req = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vitest", version: "0" } },
    };
    child.stdin.write(JSON.stringify(req) + "\n");
  });
}

function parseFirstJson(buf: string): InitResponse | null {
  const line = buf.split("\n").find((l) => l.trim().startsWith("{"));
  if (!line) return null;
  try {
    return JSON.parse(line) as InitResponse;
  } catch {
    return null;
  }
}
