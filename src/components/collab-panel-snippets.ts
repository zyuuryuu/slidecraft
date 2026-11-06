/**
 * Pure registration-snippet helpers for CollabPanel (#297, #520). Split out of the .tsx so react-refresh
 * doesn't warn about a component file exporting plain values, and so the display logic is directly
 * unit-testable without rendering. No DOM / Tauri here — the install facts come in as plain data.
 */

/** The one-word launcher the installers put on PATH (macOS cask today; Windows/Linux via #519). */
export const LAUNCHER = "slidecraft-mcp";

/** Primary registration line — launcher form. Register once; never changes across GUI restarts. */
export const STDIO_SNIPPET = `claude mcp add slidecraft -- ${LAUNCHER}`;

/** Claude Desktop / Cursor register this via mcp.json's "command" field (launcher form). */
export const DESKTOP_JSON_SNIPPET = `{"command": "${LAUNCHER}"}`;

/** The install facts come from the IPC layer (Rust `mcp_install_info`); re-exported for callers/tests. */
export type { InstallOs, McpInstallInfo } from "../ipc/mcp-install";

import type { InstallOs as Os, McpInstallInfo as Info } from "../ipc/mcp-install";

export interface RegistrationSnippets {
  /** Claude Code: `claude mcp add slidecraft -- <command> [args]`, shell-quoted per OS. */
  claudeCode: string;
  /** Claude Desktop: the server entry (`{"command": …, "args": […]}`) to paste under `mcpServers`. */
  desktopJson: string;
  /** Cursor & co.: a complete `{"mcpServers": {"slidecraft": …}}` fragment, pretty-printed. */
  mcpJson: string;
}

/** cmd.exe / PowerShell: double-quote only when needed (paths can't contain `"`). */
function quoteWindows(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p;
}

/** POSIX sh: single-quote when the path has whitespace or shell-special characters; `'` → `'\''`. */
function quotePosix(p: string): string {
  if (!/[\s'"\\$`!&|;()<>*?[\]{}~#]/.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

function quoteFor(os: Os, p: string): string {
  return os === "windows" ? quoteWindows(p) : quotePosix(p);
}

/**
 * Build the three registration forms from the install facts. `null` (browser dev mode / IPC unavailable)
 * yields the launcher form — the static text the panel showed before #520 — so a missing fact never
 * produces a half-made path.
 */
export function buildRegistrationSnippets(info: Info | null): RegistrationSnippets {
  const useLauncher = !info || info.launcherOnPath;
  const entry: { command: string; args?: string[] } = useLauncher
    ? { command: LAUNCHER }
    : { command: info.nodePath, args: [info.cliPath] };
  const argv = useLauncher ? [LAUNCHER] : [info.nodePath, info.cliPath];
  const os: Os = info?.os ?? "linux";
  return {
    claudeCode: `claude mcp add slidecraft -- ${argv.map((a) => quoteFor(os, a)).join(" ")}`,
    // Compact single-line form (matches DESKTOP_JSON_SNIPPET byte-for-byte in the launcher case).
    desktopJson: `{${Object.entries(entry).map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(", ")}}`,
    mcpJson: JSON.stringify({ mcpServers: { slidecraft: entry } }, null, 2),
  };
}

/** Fixed-width mask, independent of the real token — reveals nothing about its length either. */
const MASKED_TOKEN = "••••••••••••";

export function maskToken(token: string): string {
  return token ? MASKED_TOKEN : "";
}

/** The advanced/anti-pattern direct-HTTP registration command (ADR-0033, docs/guide/mcp.md). */
export function httpSnippet(url: string, token: string): string {
  return `claude mcp add --transport http slidecraft ${url} --header "Authorization: Bearer ${token}"`;
}
