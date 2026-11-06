/**
 * discover-probe.ts — answers the MCP 2026-07-28 version probe (`server/discover`) on the stdio front
 * BEFORE the SDK sees it, so an upstream client that probes first (Claude Code ≥ 2.1.318) gets an
 * immediate legacy signal instead of silence (#518; ADR-0038 D5 — the step before dual-era serving).
 *
 * WHY A LINE FILTER AND NOT A TRANSPORT WRAPPER. Measured on SDK 1.32.0: the probe Claude Code sends
 * carries `_meta` at the TOP LEVEL of the JSON-RPC envelope. The SDK's `JSONRPCRequestSchema` is
 * `.strict()` (types.js), so `ReadBuffer.readMessage → deserializeMessage` (shared/stdio.js) throws,
 * `StdioServerTransport.processReadBuffer` routes that to `onerror`, and the message is dropped — it
 * never reaches `Protocol._onrequest`, which would otherwise answer -32601 as it does for the same
 * probe WITHOUT the top-level key. The bytes are lost at deserialisation, so the fix must look at the
 * raw line, in front of the SDK transport. Nothing after this filter changes: every other line is
 * forwarded byte-for-byte, so the legacy handshake stays byte-identical.
 *
 * WHY -32601 (案 B) AND NOT A `DiscoverResult` LISTING ONLY 2025 VERSIONS (案 A). The 2026-07-28
 * lifecycle text makes a `DiscoverResult` the mark of a MODERN server ("the client stays modern";
 * stdio fallback happens "on any error that is not a recognized modern error"), and the Python SDK's
 * `ClientSession.adopt()` raises when `supportedVersions` has no modern version in common — it does
 * NOT fall back to `initialize`. A success reply naming only 2025 versions would therefore strand a
 * compliant client. `-32601 Method not found` is exactly the "non-modern error" the spec says sends
 * a dual-era client to the legacy `initialize` handshake, and it is byte-identical to what the SDK
 * already emits for a parseable probe — one meaning, one shape (R8).
 *
 * The reply is static and touches no deck state: this is not a second control plane (ADR-0033). In
 * forward mode the same filter sits in front of the relay's local transport, so the probe is answered
 * here and never forwarded to the host.
 */
import { Transform, type Readable, type Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, type JSONRPCMessage, type RequestId } from "@modelcontextprotocol/sdk/types.js";

export const DISCOVER_METHOD = "server/discover";

/** If `line` (one NDJSON line, without its terminator) is a `server/discover` REQUEST, returns its id;
 *  otherwise null (other methods, notifications without an id, non-JSON — all pass through untouched). */
export function parseDiscoverProbe(line: string): { id: RequestId } | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const m = v as { jsonrpc?: unknown; id?: unknown; method?: unknown };
  if (m.jsonrpc !== "2.0" || m.method !== DISCOVER_METHOD) return null;
  if (typeof m.id === "string" || (typeof m.id === "number" && Number.isInteger(m.id))) return { id: m.id };
  return null;
}

/** The reply: the SDK's own envelope for an unknown method (see header for why not a DiscoverResult). */
export function discoverProbeReply(id: RequestId): JSONRPCMessage {
  return { jsonrpc: "2.0", id, error: { code: ErrorCode.MethodNotFound, message: "Method not found" } };
}

/** Splits the incoming byte stream into NDJSON lines (same `\n` rule as the SDK's ReadBuffer, which
 *  still strips a trailing `\r` itself). A probe line is answered via `reply` and consumed; every other
 *  line is pushed on byte-for-byte, terminator included. */
class ProbeLineFilter extends Transform {
  private pending: Buffer = Buffer.alloc(0);
  /** Called with the probe's id instead of pushing the line on. Set by `createProbeAwareStdio` once the
   *  transport that carries the reply exists. Unset (never in production), a probe line is dropped
   *  silently — the pre-fix behaviour, not a crash. */
  onProbe: ((id: RequestId) => void) | undefined;
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
    let buf = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    let nl: number;
    while ((nl = buf.indexOf(0x0a)) !== -1) {
      const lineWithTerminator = buf.subarray(0, nl + 1);
      buf = buf.subarray(nl + 1);
      const probe = parseDiscoverProbe(lineWithTerminator.toString("utf8", 0, nl).replace(/\r$/, ""));
      if (probe) this.onProbe?.(probe.id);
      else this.push(lineWithTerminator);
    }
    this.pending = buf;
    cb();
  }
  _flush(cb: (error?: Error | null) => void): void {
    if (this.pending.length) this.push(this.pending);
    this.pending = Buffer.alloc(0);
    cb();
  }
}

/** A `StdioServerTransport` whose input passes through the probe filter. Drop-in for
 *  `new StdioServerTransport()` in cli.ts (solo) and as the relay's local side (forward). The reply is
 *  sent through the transport itself, so stdout has ONE writer and one serializer. */
export function createProbeAwareStdio(stdin: Readable = process.stdin, stdout: Writable = process.stdout): StdioServerTransport {
  const filter = new ProbeLineFilter();
  const transport = new StdioServerTransport(filter, stdout);
  filter.onProbe = (id) => {
    void transport.send(discoverProbeReply(id)).catch((e: unknown) => transport.onerror?.(e instanceof Error ? e : new Error(String(e))));
  };
  stdin.on("error", (e: Error) => filter.destroy(e));
  stdin.pipe(filter);
  return transport;
}
