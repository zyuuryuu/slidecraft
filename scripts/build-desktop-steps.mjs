// build-desktop-steps.mjs — the side-effect-free part of `npm run build:desktop` (scripts/build-desktop.mjs):
// how each step is spawned. Split out so tests can import it without running rustc / tauri.

/**
 * spawnSync options for one build step. Only `npm` goes through a shell, and only on Windows: there it is
 * npm.cmd, which spawn can start only via cmd.exe. A shell joins cmd and args UNQUOTED, so the Node steps
 * (cmd = process.execPath, e.g. `C:\Program Files\nodejs\node.exe`) must not use one (#558); spawned
 * directly, the argv array survives spaces. macOS / Linux never use a shell.
 */
export function stepSpawnOptions(cmd, platform, cwd) {
  return { cwd, stdio: "inherit", shell: platform === "win32" && cmd === "npm" };
}
