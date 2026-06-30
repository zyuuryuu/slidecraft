/**
 * host-handshake.test.ts — the Rust↔JS string contract for the collab READY line. host-main.ts
 * PRINTS formatReadyLine(...) on stdout; src-tauri/src/collab.rs PARSES it (strip the same prefix,
 * JSON-parse {url,token}). This locks the format so a change on the JS side can't silently break the
 * Rust supervisor (which has no shared type). The Rust prefix const must equal READY_PREFIX here.
 */
import { describe, it, expect } from "vitest";
import { READY_PREFIX, formatReadyLine, parseReadyLine } from "../src/mcp/host-handshake";

describe("collab READY handshake (Rust↔JS string contract)", () => {
  it("emits one tagged, single line that round-trips back to {url,token}", () => {
    const h = { url: "http://127.0.0.1:59299/mcp", token: "abc.DEF-123_xyz" };
    const line = formatReadyLine(h);
    expect(line.startsWith(READY_PREFIX)).toBe(true);
    expect(line).not.toContain("\n"); // must stay a single line (Rust reads it line-by-line)
    expect(parseReadyLine(line)).toEqual(h);
  });

  it("the prefix the Rust supervisor strips is exactly this constant", () => {
    expect(READY_PREFIX).toBe("SLIDECRAFT_READY "); // keep in sync with collab.rs READY_PREFIX
  });

  it("never returns a partial handshake (non-handshake / malformed / missing field → null)", () => {
    expect(parseReadyLine("[slidecraft-host] listening http://127.0.0.1:0/mcp")).toBeNull();
    expect(parseReadyLine(READY_PREFIX + "{not json")).toBeNull();
    expect(parseReadyLine(READY_PREFIX + JSON.stringify({ url: "x" }))).toBeNull(); // missing token
    expect(parseReadyLine(READY_PREFIX + JSON.stringify({ token: "y" }))).toBeNull(); // missing url
  });
});
