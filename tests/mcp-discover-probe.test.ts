/**
 * mcp-discover-probe.test.ts — #518: the MCP 2026-07-28 version probe (`server/discover`) must get an
 * immediate answer from the stdio front even BEFORE `initialize`, instead of silence.
 *
 * Root cause (measured on main d2e1277 with SDK 1.32.0): Claude Code's probe carries `_meta` at the
 * TOP LEVEL of the JSON-RPC envelope. The SDK's `JSONRPCRequestSchema` is `.strict()`, so
 * `ReadBuffer.readMessage → deserializeMessage` throws, `StdioServerTransport.processReadBuffer`
 * routes the throw to `onerror`, and the request never reaches `Protocol._onrequest` (which WOULD
 * answer -32601). That is why the plain probe (no top-level `_meta`) gets -32601 and the real probe
 * gets nothing — before and after initialize alike.
 *
 * The fix sits where the bytes are lost: a line filter in front of the SDK transport
 * (`src/mcp/discover-probe.ts`). `InMemoryTransport` cannot reproduce the bug (it hands already
 * parsed objects to `onmessage`, skipping the wire schema), so these tests drive the REAL
 * `StdioServerTransport` over in-memory `PassThrough` streams — no subprocess, no real stdio.
 */
import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "../src/mcp/server";
import { createSession } from "../src/mcp/session";
import { createSoloHostContext } from "../src/mcp/host-core";
import { AdaptiveFront, type Attachment, type FrontWire } from "../src/mcp/adaptive-front";
import { handshake, type InitParams } from "../src/mcp/host-attach";
import type { HostHandshake } from "../src/mcp/host-json";
import { createProbeAwareStdio, parseDiscoverProbe } from "../src/mcp/discover-probe";

/** Claude Code's probe as measured in #518 — `_meta` sits at the TOP LEVEL of the envelope. */
const PROBE_TOP_META = {
  jsonrpc: "2.0", id: 1, method: "server/discover", params: {},
  _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
};
/** The spec's own example shape (schema 2026-07-28 `DiscoverRequest`): `_meta` inside `params`. */
const PROBE_PARAMS_META = {
  jsonrpc: "2.0", id: "discover-1", method: "server/discover",
  params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } },
};
const INITIALIZE = {
  jsonrpc: "2.0", id: 10, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "0" } },
};
const INITIALIZED = { jsonrpc: "2.0", method: "notifications/initialized" };
const TOOLS_LIST = { jsonrpc: "2.0", id: 11, method: "tools/list", params: {} };

const line = (m: unknown): string => JSON.stringify(m) + "\n";

/** An in-memory stdio pair: `stdin` is what the process would read, `out` collects every byte written
 *  to its stdout. `waitFor(id)` resolves with the parsed reply for that request id, or rejects after
 *  `timeoutMs` — the silence #518 is about. */
function makeStdio() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let out = "";
  stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
  const replies = (): Array<Record<string, unknown>> =>
    out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const waitFor = (id: string | number, timeoutMs: number): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = (): void => {
        const hit = replies().find((r) => r.id === id);
        if (hit) return resolve(hit);
        if (Date.now() - t0 > timeoutMs) return reject(new Error(`no reply for id=${String(id)} within ${timeoutMs}ms; stdout=${JSON.stringify(out)}`));
        setTimeout(tick, 2);
      };
      tick();
    });
  return { stdin, stdout, bytes: () => out, replies, waitFor };
}

/** The exact -32601 envelope the SDK's own `Protocol._onrequest` emits for an unknown method. */
const METHOD_NOT_FOUND = (id: string | number) => ({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });

describe("parseDiscoverProbe — recognises only a server/discover REQUEST line", () => {
  it("accepts Claude Code's top-level-_meta probe and the spec's params._meta form, returning the id", () => {
    expect(parseDiscoverProbe(JSON.stringify(PROBE_TOP_META))).toEqual({ id: 1 });
    expect(parseDiscoverProbe(JSON.stringify(PROBE_PARAMS_META))).toEqual({ id: "discover-1" });
  });
  it("passes everything else through: other methods, notifications (no id), non-JSON, non-objects", () => {
    expect(parseDiscoverProbe(JSON.stringify(INITIALIZE))).toBeNull();
    expect(parseDiscoverProbe(JSON.stringify({ jsonrpc: "2.0", method: "server/discover", params: {} }))).toBeNull();
    expect(parseDiscoverProbe("not json")).toBeNull();
    expect(parseDiscoverProbe("[1,2]")).toBeNull();
    expect(parseDiscoverProbe("null")).toBeNull();
    expect(parseDiscoverProbe(JSON.stringify({ jsonrpc: "1.0", id: 1, method: "server/discover" }))).toBeNull();
  });
});

describe("solo stdio front — server/discover as the very first message (#518)", () => {
  it("baseline (plain SDK transport): the top-level-_meta probe gets NO reply — the bug being fixed", async () => {
    const io = makeStdio();
    const server = buildServer(createSession(null), { registerResources: true });
    await server.connect(new StdioServerTransport(io.stdin, io.stdout));
    io.stdin.write(line(PROBE_TOP_META));
    await expect(io.waitFor(1, 300)).rejects.toThrow(/no reply/);
    await server.close();
  });

  it("answers the probe within 100ms, before initialize, with the SDK's own -32601 envelope (案 B)", async () => {
    const io = makeStdio();
    const server = buildServer(createSession(null), { registerResources: true });
    await server.connect(createProbeAwareStdio(io.stdin, io.stdout));
    io.stdin.write(line(PROBE_TOP_META));
    const reply = await io.waitFor(1, 100);
    expect(reply).toEqual(METHOD_NOT_FOUND(1));
    // The spec-shaped probe (params._meta) takes the same path and gets the same answer.
    io.stdin.write(line(PROBE_PARAMS_META));
    expect(await io.waitFor("discover-1", 100)).toEqual(METHOD_NOT_FOUND("discover-1"));
    // The legacy handshake still works afterwards.
    io.stdin.write(line(INITIALIZE));
    const init = (await io.waitFor(10, 2000)) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe("slidecraft");
    io.stdin.write(line(INITIALIZED));
    io.stdin.write(line(TOOLS_LIST));
    const tools = (await io.waitFor(11, 2000)) as { result: { tools: unknown[] } };
    expect(tools.result.tools.length).toBeGreaterThan(0);
    await server.close();
  });

  it("R8 agreement: the filter's reply is byte-identical to what the SDK itself emits for a plain probe", async () => {
    // Plain probe (no top-level _meta) parses fine and the SDK answers it after initialize — that is
    // the reference envelope. The filter must not invent a second shape for the same meaning.
    const ref = makeStdio();
    const refServer = buildServer(createSession(null), { registerResources: true });
    await refServer.connect(new StdioServerTransport(ref.stdin, ref.stdout));
    ref.stdin.write(line({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }));
    await ref.waitFor(1, 1000);
    await refServer.close();

    const io = makeStdio();
    const server = buildServer(createSession(null), { registerResources: true });
    await server.connect(createProbeAwareStdio(io.stdin, io.stdout));
    io.stdin.write(line(PROBE_TOP_META));
    await io.waitFor(1, 100);
    await server.close();

    expect(io.bytes()).toBe(ref.bytes());
  });

  it("legacy path is byte-identical with and without the filter (initialize → initialized → tools/list)", async () => {
    const run = async (wrap: boolean): Promise<string> => {
      const io = makeStdio();
      const server = buildServer(createSession(null), { registerResources: true });
      await server.connect(wrap ? createProbeAwareStdio(io.stdin, io.stdout) : new StdioServerTransport(io.stdin, io.stdout));
      io.stdin.write(line(INITIALIZE));
      await io.waitFor(10, 2000);
      io.stdin.write(line(INITIALIZED));
      io.stdin.write(line(TOOLS_LIST));
      await io.waitFor(11, 2000);
      await server.close();
      return io.bytes();
    };
    const [plain, filtered] = await Promise.all([run(false), run(true)]);
    expect(filtered).toBe(plain);
    expect(plain.length).toBeGreaterThan(0);
  });

  it("a line split across chunks and a CRLF line are reassembled before the probe check", async () => {
    const io = makeStdio();
    const server = buildServer(createSession(null), { registerResources: true });
    await server.connect(createProbeAwareStdio(io.stdin, io.stdout));
    const probe = JSON.stringify(PROBE_TOP_META);
    io.stdin.write(probe.slice(0, 20));
    io.stdin.write(probe.slice(20) + "\r\n");
    expect(await io.waitFor(1, 100)).toEqual(METHOD_NOT_FOUND(1));
    // Two messages in one chunk.
    io.stdin.write(line({ ...PROBE_TOP_META, id: 2 }) + line(INITIALIZE));
    expect(await io.waitFor(2, 100)).toEqual(METHOD_NOT_FOUND(2));
    expect(((await io.waitFor(10, 2000)) as { result: unknown }).result).toBeTruthy();
    await server.close();
  });
});

describe("forward front — the probe is answered locally and never reaches the host (#518)", () => {
  // Since #728 forwarding is the adaptive front's (adaptive-front.ts; the old runRelay is gone). Wired as cli.ts
  // wires it: the probe-aware stdio is the local wire, a real solo server answers `initialize`, and the first
  // tool call attaches to the host (the adapter's own `initialize`, host-attach.handshake) and is forwarded.
  it("forward: -32601 within 100ms locally (before and after the switch); the host never sees server/discover", async () => {
    const H: HostHandshake = { url: "http://127.0.0.1:5999/mcp", token: "t", pid: process.pid, startedAt: new Date().toISOString() };
    const forwarded: string[] = [];
    const remoteServer = buildServer(createSession(null), { registerResources: false });
    const attach = async (host: HostHandshake, init: InitParams): Promise<Attachment> => {
      const [c, srv] = InMemoryTransport.createLinkedPair();
      await remoteServer.connect(srv);
      const wire: FrontWire = {
        start: () => c.start(),
        close: () => c.close(),
        send: (m: JSONRPCMessage) => {
          forwarded.push((m as { method?: string }).method ?? "<response>");
          return c.send(m);
        },
        set onmessage(h: ((m: JSONRPCMessage) => void) | undefined) { c.onmessage = h; },
        get onmessage() { return c.onmessage; },
      };
      await wire.start();
      await handshake(wire, init, 2000);
      return { host, wire, afterAdmitted: async () => {}, forgetSecret: () => {}, close: () => wire.close() };
    };
    const session = createSession(null);
    const soloServer = buildServer(session, { host: createSoloHostContext(session), registerResources: true });
    const [soloFront, soloEnd] = InMemoryTransport.createLinkedPair();
    await soloServer.connect(soloEnd);
    const io = makeStdio();
    const front = new AdaptiveFront({
      local: createProbeAwareStdio(io.stdin, io.stdout),
      solo: soloFront,
      soloDeckDocId: () => null,
      watch: { live: async () => H, markDead: () => {} },
      attach,
      log: () => {},
    });
    await front.start();

    io.stdin.write(line(PROBE_TOP_META));
    expect(await io.waitFor(1, 100)).toEqual(METHOD_NOT_FOUND(1));

    io.stdin.write(line(INITIALIZE));
    const init = (await io.waitFor(10, 2000)) as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe("slidecraft");
    io.stdin.write(line(INITIALIZED));

    io.stdin.write(line({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "get_project_info", arguments: {} } }));
    await io.waitFor(12, 2000);
    expect(front.mode).toBe("forward");
    expect(forwarded).toEqual(expect.arrayContaining(["initialize", "tools/call"]));

    io.stdin.write(line({ ...PROBE_TOP_META, id: 2 }));
    expect(await io.waitFor(2, 100)).toEqual(METHOD_NOT_FOUND(2));
    expect(forwarded).not.toContain("server/discover");

    await front.close();
    await remoteServer.close();
    await soloServer.close();
  });
});
