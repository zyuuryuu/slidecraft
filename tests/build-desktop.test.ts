// #558 — `npm run build:desktop` always failed on Windows with Node in `C:\Program Files\nodejs`.
//
// build-desktop.mjs's step() spawned EVERY step with `shell: true` on Windows. With a shell, Node joins
// `cmd` and `args` unquoted for cmd.exe, so the Node steps' `process.execPath` split at the space
// ("'C:\Program' is not recognized"). Only `npm` (npm.cmd on Windows) needs a shell; the Node steps must
// be spawned directly with an argv array, which survives spaces in the executable path.
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { stepSpawnOptions } from "../scripts/build-desktop-steps.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIN_NODE = "C:\\Program Files\\nodejs\\node.exe";

describe("build-desktop: which steps go through a shell (#558)", () => {
  it("on Windows the Node steps are spawned WITHOUT a shell (execPath may contain spaces)", () => {
    expect(stepSpawnOptions(WIN_NODE, "win32").shell).toBe(false);
  });

  it("on Windows npm (npm.cmd) is still spawned through a shell", () => {
    expect(stepSpawnOptions("npm", "win32").shell).toBe(true);
  });

  it("macOS / Linux never use a shell (unchanged)", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(stepSpawnOptions("npm", platform).shell).toBe(false);
      expect(stepSpawnOptions("/usr/local/bin/node", platform).shell).toBe(false);
    }
  });

  it("every step runs from the repo root with inherited stdio", () => {
    const o = stepSpawnOptions(WIN_NODE, "win32", "/repo");
    expect(o.cwd).toBe("/repo");
    expect(o.stdio).toBe("inherit");
  });
});

describe("build-desktop.mjs wiring (#558 invariant: same three steps, same order, same args)", () => {
  const src = readFileSync(join(root, "scripts/build-desktop.mjs"), "utf8");

  it("every step is spawned with stepSpawnOptions (no inline shell decision left)", () => {
    expect(src).toMatch(/spawnSync\(cmd, args, stepSpawnOptions\(cmd, process\.platform, root\)\)/);
    expect(src).not.toMatch(/shell:/);
  });

  it("stage-node → stage-llamafile → npm tauri build with bundleConfigArgs and pass-through args", () => {
    const steps = src.split("\n").filter((l) => l.startsWith("step("));
    expect(steps).toEqual([
      'step(process.execPath, [join("scripts", "stage-node.mjs"), triple]);',
      'step(process.execPath, [join("scripts", "stage-llamafile.mjs"), triple]);',
      'step("npm", ["run", "tauri", "--", "build", ...bundleConfigArgs(triple), ...process.argv.slice(2)]);',
    ]);
    // The Windows Node steps (cmd = execPath) get no shell; the npm step does.
    expect([WIN_NODE, WIN_NODE, "npm"].map((c) => stepSpawnOptions(c, "win32").shell)).toEqual([false, false, true]);
  });
});

describe("build-desktop: a Node step whose executable path contains a space actually runs (#558)", () => {
  const dir = mkdtempSync(join(tmpdir(), "sc-558-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("spawns a copy of node under 'Program Files' with the host platform's options", () => {
    const binDir = join(dir, "Program Files", "nodejs");
    mkdirSync(binDir, { recursive: true });
    const exe = join(binDir, process.platform === "win32" ? "node.exe" : "node");
    copyFileSync(process.execPath, exe);
    const r = spawnSync(exe, ["-e", "process.exit(7)"], { ...stepSpawnOptions(exe, process.platform, dir), stdio: "pipe" });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(7);
  });
});
