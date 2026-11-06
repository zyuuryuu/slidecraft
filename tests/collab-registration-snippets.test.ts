/**
 * #520 — MCP registration snippets generated from the REAL install (OS × launcher-on-PATH × paths with
 * whitespace). Pure function, no DOM/Tauri: `buildRegistrationSnippets(info)` → the Claude Code one-liner,
 * the Claude Desktop server entry, and a generic mcp.json fragment (Cursor etc.).
 *
 * Locks:
 *  1. launcher on PATH → one word (`slidecraft-mcp`), identical on every OS (ADR-0038 D5 / #519 invariant).
 *  2. no launcher → the bundled node + cli.cjs REAL paths, quoted per OS when they contain whitespace
 *     (Windows: "…"; POSIX: '…'), and unquoted when they don't.
 *  3. JSON forms carry the paths as proper JSON strings (backslashes escaped, no shell quoting).
 *  4. agreement (R8): the launcher form equals the static fallback constants the panel showed before #520.
 */
import { describe, it, expect } from "vitest";
import {
  buildRegistrationSnippets,
  STDIO_SNIPPET,
  DESKTOP_JSON_SNIPPET,
  type McpInstallInfo,
} from "../src/components/collab-panel-snippets";

// Windows paths are the REAL install layout: Tauri's NSIS/WiX put resources (cli.cjs) and the node.exe
// sidecar FLAT in the install dir (no `resources\` subfolder) — confirmed on a Windows 11 install (#538).
const WIN_SPACES: McpInstallInfo = {
  os: "windows",
  launcherOnPath: false,
  nodePath: "C:\\Users\\A B\\AppData\\Local\\SlideCraft\\node.exe",
  cliPath: "C:\\Users\\A B\\AppData\\Local\\SlideCraft\\cli.cjs",
};

const WIN_PLAIN: McpInstallInfo = {
  os: "windows",
  launcherOnPath: false,
  nodePath: "C:\\Program\\SlideCraft\\node.exe",
  cliPath: "C:\\Program\\SlideCraft\\cli.cjs",
};

const MAC_LAUNCHER: McpInstallInfo = {
  os: "macos",
  launcherOnPath: true,
  nodePath: "/Applications/SlideCraft.app/Contents/MacOS/node",
  cliPath: "/Applications/SlideCraft.app/Contents/Resources/cli.cjs",
};

const MAC_SPACES: McpInstallInfo = {
  os: "macos",
  launcherOnPath: false,
  nodePath: "/Users/a b/Applications/SlideCraft.app/Contents/MacOS/node",
  cliPath: "/Users/a b/Applications/SlideCraft.app/Contents/Resources/cli.cjs",
};

const LINUX_PLAIN: McpInstallInfo = {
  os: "linux",
  launcherOnPath: false,
  nodePath: "/usr/bin/node",
  cliPath: "/usr/lib/slidecraft/cli.cjs",
};

describe("buildRegistrationSnippets — acceptance examples (#520)", () => {
  it("Windows + no launcher + path with spaces → quoted node.exe and cli.cjs after `--`", () => {
    const s = buildRegistrationSnippets(WIN_SPACES);
    expect(s.claudeCode).toBe(
      'claude mcp add slidecraft -- "C:\\Users\\A B\\AppData\\Local\\SlideCraft\\node.exe" "C:\\Users\\A B\\AppData\\Local\\SlideCraft\\cli.cjs"',
    );
  });

  it("macOS + launcher on PATH → the one-word launcher line", () => {
    expect(buildRegistrationSnippets(MAC_LAUNCHER).claudeCode).toBe("claude mcp add slidecraft -- slidecraft-mcp");
  });
});

describe("buildRegistrationSnippets — Claude Code one-liner quoting", () => {
  it("Windows without whitespace stays unquoted", () => {
    expect(buildRegistrationSnippets(WIN_PLAIN).claudeCode).toBe(
      "claude mcp add slidecraft -- C:\\Program\\SlideCraft\\node.exe C:\\Program\\SlideCraft\\cli.cjs",
    );
  });

  it("POSIX with whitespace uses single quotes", () => {
    expect(buildRegistrationSnippets(MAC_SPACES).claudeCode).toBe(
      "claude mcp add slidecraft -- '/Users/a b/Applications/SlideCraft.app/Contents/MacOS/node' '/Users/a b/Applications/SlideCraft.app/Contents/Resources/cli.cjs'",
    );
  });

  it("POSIX path containing a single quote is escaped, not truncated", () => {
    const s = buildRegistrationSnippets({ ...LINUX_PLAIN, nodePath: "/opt/o'neil apps/node" });
    expect(s.claudeCode).toContain(`'/opt/o'\\''neil apps/node'`);
  });

  it("Linux without whitespace stays unquoted", () => {
    expect(buildRegistrationSnippets(LINUX_PLAIN).claudeCode).toBe(
      "claude mcp add slidecraft -- /usr/bin/node /usr/lib/slidecraft/cli.cjs",
    );
  });

  it("launcher on PATH wins on every OS — paths are ignored", () => {
    for (const os of ["windows", "macos", "linux"] as const) {
      const s = buildRegistrationSnippets({ ...WIN_SPACES, os, launcherOnPath: true });
      expect(s.claudeCode).toBe("claude mcp add slidecraft -- slidecraft-mcp");
      expect(s.desktopJson).toBe('{"command": "slidecraft-mcp"}');
    }
  });
});

describe("buildRegistrationSnippets — JSON forms", () => {
  it("Claude Desktop entry: command = node, args = [cli.cjs], paths JSON-escaped (no shell quotes)", () => {
    const s = buildRegistrationSnippets(WIN_SPACES);
    const parsed = JSON.parse(s.desktopJson) as { command: string; args: string[] };
    expect(parsed).toEqual({ command: WIN_SPACES.nodePath, args: [WIN_SPACES.cliPath] });
    expect(s.desktopJson).not.toContain("'");
  });

  it("generic mcp.json fragment nests the same entry under mcpServers.slidecraft", () => {
    const s = buildRegistrationSnippets(MAC_SPACES);
    const parsed = JSON.parse(s.mcpJson) as { mcpServers: { slidecraft: { command: string; args: string[] } } };
    expect(parsed.mcpServers.slidecraft).toEqual(JSON.parse(s.desktopJson));
    expect(parsed.mcpServers.slidecraft.command).toBe(MAC_SPACES.nodePath);
  });

  it("launcher form of mcp.json has no args key", () => {
    const parsed = JSON.parse(buildRegistrationSnippets(MAC_LAUNCHER).mcpJson) as { mcpServers: { slidecraft: Record<string, unknown> } };
    expect(parsed.mcpServers.slidecraft).toEqual({ command: "slidecraft-mcp" });
  });
});

describe("agreement (R8): launcher form == the static fallback constants", () => {
  it("claudeCode equals STDIO_SNIPPET and desktopJson equals DESKTOP_JSON_SNIPPET", () => {
    const s = buildRegistrationSnippets(MAC_LAUNCHER);
    expect(s.claudeCode).toBe(STDIO_SNIPPET);
    expect(s.desktopJson).toBe(DESKTOP_JSON_SNIPPET);
  });

  it("the browser-mode fallback (no install info) is the launcher form", () => {
    const s = buildRegistrationSnippets(null);
    expect(s.claudeCode).toBe(STDIO_SNIPPET);
    expect(s.desktopJson).toBe(DESKTOP_JSON_SNIPPET);
  });
});
