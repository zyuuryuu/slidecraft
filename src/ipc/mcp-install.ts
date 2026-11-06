/**
 * mcp-install.ts — the facts the 協働 panel needs to write an MCP registration that runs on THIS
 * install (#520): OS, whether the `slidecraft-mcp` launcher is on PATH, and the real paths of the
 * bundled node + cli.cjs. Dual-mode like app-fetch.ts: desktop asks Rust (`mcp_install_info`, read-only —
 * it executes and writes nothing); a plain browser has no install, so the caller falls back to the
 * static launcher-form text. Never-silent: an IPC failure is RETURNED (reason), not swallowed, so the
 * panel can say why it is showing the generic form.
 */
import { runningInTauri } from "./commands";

export type InstallOs = "windows" | "macos" | "linux";

/** What the panel needs to know about THIS install to write a registration that actually runs. */
export interface McpInstallInfo {
  os: InstallOs;
  /** `slidecraft-mcp` resolvable from the user's shell → one-word form; else the real paths below. */
  launcherOnPath: boolean;
  /** Bundled Node runtime (next to the app executable; `node.exe` on Windows). */
  nodePath: string;
  /** Bundled self-contained MCP server (`cli.cjs`, under the app's resource dir). */
  cliPath: string;
}

export type McpInstallLookup =
  | { kind: "resolved"; info: McpInstallInfo }
  /** Browser dev/demo mode — there is no bundled install to describe. */
  | { kind: "browser" }
  /** Desktop, but the Rust command failed (message is the Rust error string). */
  | { kind: "error"; error: string };

/** Rust reports `std::env::consts::OS`; anything that isn't windows/macos is quoted as POSIX. */
function normalizeOs(os: unknown): McpInstallInfo["os"] {
  return os === "windows" || os === "macos" ? os : "linux";
}

export async function lookupMcpInstall(): Promise<McpInstallLookup> {
  if (!runningInTauri()) return { kind: "browser" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<{ os: string; launcherOnPath: boolean; nodePath: string; cliPath: string }>("mcp_install_info");
    return {
      kind: "resolved",
      info: { os: normalizeOs(raw.os), launcherOnPath: !!raw.launcherOnPath, nodePath: raw.nodePath, cliPath: raw.cliPath },
    };
  } catch (e) {
    return { kind: "error", error: e instanceof Error ? e.message : String(e) };
  }
}
