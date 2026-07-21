/**
 * Pure registration-snippet helpers for CollabPanel (#297). Split out of the .tsx so react-refresh
 * doesn't warn about a component file exporting plain values, and so the display logic is directly
 * unit-testable without rendering.
 */

/** Primary registration line — static, no url/token needed. Register once; never changes across GUI restarts. */
export const STDIO_SNIPPET = "claude mcp add slidecraft -- slidecraft-mcp";

/** Claude Desktop / Cursor register this via mcp.json's "command" field. */
export const DESKTOP_JSON_SNIPPET = '{"command": "slidecraft-mcp"}';

/** Fixed-width mask, independent of the real token — reveals nothing about its length either. */
const MASKED_TOKEN = "••••••••••••";

export function maskToken(token: string): string {
  return token ? MASKED_TOKEN : "";
}

/** The advanced/anti-pattern direct-HTTP registration command (ADR-0033, docs/guide/mcp.md). */
export function httpSnippet(url: string, token: string): string {
  return `claude mcp add --transport http slidecraft ${url} --header "Authorization: Bearer ${token}"`;
}
