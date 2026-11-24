/**
 * adaptive-front.test.ts — #728 (ADR-0040 D2/D3): the adapter's router, driven in memory. The AI is an SDK Client;
 * the solo side is the real solo server; "hosts" are real collab-profile servers behind fake attachments whose
 * wire can be killed. What is pinned:
 *  - the decision is made in front of each tool call and that very call is forwarded after a switch;
 *  - a solo deck is never carried over (note instead), and a lost host brings the adapter back to solo (note);
 *  - the AI hears notifications/tools/list_changed on every switch;
 *  - authorization-denied keeps the adapter solo against that host launch; -revoked drops the secret and re-applies;
 *  - the first admitted call redeems the one-time claim.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { createSoloHostContext, openDeckDocId, DocRegistry, MemTemplateStore, type HostContext } from "../src/mcp/host-core";
import { GuardError, type GuardCode } from "../src/mcp/guard-errors";
import { AdaptiveFront, type Attachment, type FrontWire } from "../src/mcp/adaptive-front";
import { handshake, type InitParams } from "../src/mcp/host-attach";
import type { HostHandshake } from "../src/mcp/host-json";

const templateB64 = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")).toString("base64");
const H1: HostHandshake = { url: "http://127.0.0.1:5001/mcp", token: "t1", pid: 1, startedAt: "2026-11-23T00:00:00.000Z" };
const H2: HostHandshake = { url: "http://127.0.0.1:5002/mcp", token: "t2", pid: 2, startedAt: "2026-11-23T01:00:00.000Z" };

/** A collab-AI-profile server standing in for a GUI host; `title` tells hosts apart, `gate` plays admitCall. */
function fakeHost(title: string) {
  const registry = new DocRegistry();
  registry.create(createSession(null), title, true);
  const state: { gate: GuardCode | undefined; dead: boolean } = { gate: undefined, dead: false };
  const ctx: HostContext = {
    registry,
    active: () => undefined,
    setActive: () => {},
    sharedOnly: true,
    templates: new MemTemplateStore(),
    admitCall: async () => {
      if (state.gate) throw new GuardError(`gate: ${state.gate}`, state.gate);
      return undefined;
    },
  };
  return { ctx, state };
}

function setup(opts: { hosts?: Record<string, ReturnType<typeof fakeHost>> } = {}) {
  const hosts = opts.hosts ?? { [H1.url]: fakeHost("H1") };
  let live: HostHandshake | null = null;
  const watch = { live: vi.fn(async () => live), markDead: vi.fn((h: HostHandshake) => { if (live && live.url === h.url) live = null; }) };
  const redeemed: string[] = [];
  const forgot: string[] = [];
  const attachInits: InitParams[] = [];
  const hostServers: ReturnType<typeof buildServer>[] = [];
  const attach = vi.fn(async (h: HostHandshake, init: InitParams): Promise<Attachment> => {
    attachInits.push(init);
    const fh = hosts[h.url];
    if (!fh || fh.state.dead) throw new Error("connection refused");
    const server = buildServer(createSession(null), { host: fh.ctx, registerResources: false });
    hostServers.push(server);
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    const wire: FrontWire = {
      start: () => c.start(),
      send: async (m: JSONRPCMessage) => {
        if (fh.state.dead) throw new Error("fetch failed: connection refused");
        return c.send(m);
      },
      close: () => c.close(),
      // handlers set on the wire are the transport's handlers
      set onmessage(h) { c.onmessage = h; },
      get onmessage() { return c.onmessage; },
    };
    await wire.start();
    await handshake(wire, init, 2000);
    return { host: h, wire, afterAdmitted: async () => void redeemed.push(h.url), forgetSecret: () => void forgot.push(h.url), close: () => wire.close() };
  });

  const session = createSession(null);
  const soloCtx = createSoloHostContext(session);
  const soloServer = buildServer(session, { host: soloCtx, registerResources: true });
  const [soloFront, soloServerEnd] = InMemoryTransport.createLinkedPair();
  const [aiEnd, localEnd] = InMemoryTransport.createLinkedPair();
  const front = new AdaptiveFront({ local: localEnd, solo: soloFront, soloDeckDocId: () => openDeckDocId(soloCtx.registry), watch, attach, log: () => {} });
  const ai = new Client({ name: "Claude Desktop", version: "0.9.0" });
  let listChanged = 0;
  ai.setNotificationHandler(ToolListChangedNotificationSchema, async () => void listChanged++);

  const call = async (name: string, args: Record<string, unknown> = {}) =>
    JSON.parse(((await ai.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;
  const start = async () => {
    await soloServer.connect(soloServerEnd);
    await front.start();
    await ai.connect(aiEnd);
  };
  return {
    start, call, ai, front, attach, watch, attachInits, redeemed, forgot, hosts, hostServers,
    setLive: (h: HostHandshake | null) => void (live = h),
    listChanged: () => listChanged,
    soloCtx,
  };
}

const titles = (r: Record<string, unknown>) => (r.documents as { title: string }[] | undefined)?.map((d) => d.title);
const flush = () => new Promise((r) => setTimeout(r, 10));

describe("no host: solo answers, unchanged (no note)", () => {
  it("a tool call goes to the solo server; nothing is attached", async () => {
    const t = setup();
    await t.start();
    const info = await t.call("get_project_info");
    expect(info).not.toHaveProperty("note");
    expect(t.attach).not.toHaveBeenCalled();
    expect(t.watch.live).toHaveBeenCalled(); // asked in front of the call
  });
});

describe("solo without a deck + a live host → that very call is forwarded", () => {
  it("attaches with the AI's remembered clientInfo, forwards, and tells the AI the tool list changed", async () => {
    const t = setup();
    await t.start();
    await t.call("get_project_info"); // solo first
    t.setLive(H1);
    const r = await t.call("list_documents"); // a collab-only tool — only the host answers it
    expect(titles(r)).toEqual(["H1"]);
    expect(t.attach).toHaveBeenCalledTimes(1);
    expect(t.attachInits[0].clientInfo).toEqual({ name: "Claude Desktop", version: "0.9.0" });
    await flush();
    expect(t.listChanged()).toBe(1);
    // the tool list the AI re-reads now comes from the host
    expect((await t.ai.listTools()).tools.map((x) => x.name)).toContain("list_documents");
  });

  it("the first admitted call redeems the one-time claim", async () => {
    const t = setup();
    await t.start();
    t.setLive(H1);
    await t.call("list_documents");
    await flush();
    expect(t.redeemed).toEqual([H1.url]);
  });
});

describe("while forwarding, the host's own messages reach the AI (the pass-through the old runRelay pinned — #736)", () => {
  it("a host notification (deckChanged) is delivered to the AI as is", async () => {
    const t = setup();
    const seen: { method: string; params?: unknown }[] = [];
    t.ai.fallbackNotificationHandler = async (n) => void seen.push(n);
    await t.start();
    t.setLive(H1);
    await t.call("list_documents"); // attached
    await t.hostServers[0].server.notification({ method: "notifications/slidecraft/deckChanged", params: { docId: "d1", rev: 2 } });
    for (let i = 0; i < 100 && !seen.some((n) => n.method.endsWith("deckChanged")); i++) await flush();
    expect(seen).toContainEqual({ jsonrpc: "2.0", method: "notifications/slidecraft/deckChanged", params: { docId: "d1", rev: 2 } });
  });

  it("the forwarding modules hold no deck state: adaptive-front.ts / host-attach.ts never import host-core or session (ADR-0033)", () => {
    for (const f of ["adaptive-front.ts", "host-attach.ts"]) {
      const src = readFileSync(resolve(__dirname, "../src/mcp", f), "utf8");
      expect(src).not.toMatch(/from ["']\.\/host-core["']/);
      expect(src).not.toMatch(/from ["']\.\/session["']/);
    }
  });
});

describe("solo with a deck + a live host → stays solo, note says how to connect", () => {
  it("note names close_document + the docId; after closing, the next call attaches", async () => {
    const t = setup();
    await t.start();
    const { docId } = (await t.call("new_project", { templateBase64: templateB64, markdown: "# A" })) as { docId: string };
    t.setLive(H1);
    const r = await t.call("get_project_info");
    expect(String(r.note)).toContain("close_document");
    expect(String(r.note)).toContain(docId);
    expect(t.attach).not.toHaveBeenCalled();
    expect(openDeckDocId(t.soloCtx.registry)).toBe(docId); // the deck is untouched

    const closed = await t.call("close_document", { docId, force: true });
    expect(closed).toMatchObject({ ok: true, closed: true });
    expect(titles(await t.call("list_documents"))).toEqual(["H1"]);
  });
});

describe("a live host that cannot be attached (never silent)", () => {
  it("the ping answered but the attach failed → solo answers this call with a note saying so", async () => {
    const t = setup();
    t.hosts[H1.url].state.dead = true; // attach refuses
    await t.start();
    t.setLive(H1);
    const r = await t.call("get_project_info");
    expect(String(r.note)).toContain("接続できませんでした");
    expect(String(r.note)).toContain("connection refused");
    expect(t.watch.markDead).toHaveBeenCalledWith(H1);
    expect(await t.call("get_project_info")).not.toHaveProperty("note"); // said once, not on every call
  });
});

describe("forward + host lost", () => {
  it("no new host → solo without a deck, the call is answered by solo with a note, list_changed again", async () => {
    const t = setup();
    await t.start();
    t.setLive(H1);
    await t.call("list_documents");
    t.hosts[H1.url].state.dead = true;
    t.setLive(null);
    const r = await t.call("get_project_info");
    expect(String(r.note)).toContain("単独");
    expect(t.watch.markDead).toHaveBeenCalledWith(H1);
    await flush();
    expect(t.listChanged()).toBe(2);
    // back in solo: no note on the next call
    expect(await t.call("get_project_info")).not.toHaveProperty("note");
  });

  it("a new host took over → re-attach and forward the call there", async () => {
    const hosts = { [H1.url]: fakeHost("H1"), [H2.url]: fakeHost("H2") };
    const t = setup({ hosts });
    await t.start();
    t.setLive(H1);
    expect(titles(await t.call("list_documents"))).toEqual(["H1"]);
    hosts[H1.url].state.dead = true;
    t.setLive(H2);
    expect(titles(await t.call("list_documents"))).toEqual(["H2"]);
    expect(t.attach).toHaveBeenCalledTimes(2);
  });
});

describe("authorization outcomes (ADR-0040 D3-3/D3-5)", () => {
  it("authorization-pending is passed through as is (the host's text asks for [許可] in the GUI)", async () => {
    const t = setup();
    t.hosts[H1.url].state.gate = "authorization-pending";
    await t.start();
    t.setLive(H1);
    expect(await t.call("list_documents")).toMatchObject({ ok: false, code: "authorization-pending" });
    expect(t.redeemed).toEqual([]); // not admitted → no claim redeemed
    t.hosts[H1.url].state.gate = undefined;
    expect(titles(await t.call("list_documents"))).toEqual(["H1"]); // still forwarding: allowed now
  });

  it("an SDK-level refusal (unknown tool / bad arguments, answered before the call gate) is not taken as admission", async () => {
    const t = setup();
    t.hosts[H1.url].state.gate = "authorization-pending";
    await t.start();
    t.setLive(H1);
    // The SDK answers these itself, before the tool's handler (so before admitCall): an isError result with plain
    // text, or a JSON-RPC error — neither proves the host admitted this client.
    const unknown = await t.ai.callTool({ name: "no_such_tool", arguments: {} }).catch((e: unknown) => e);
    expect(unknown).toMatchObject({ isError: true });
    const bad = await t.ai.callTool({ name: "open_document", arguments: { docId: 42 } }).catch((e: unknown) => e);
    expect(bad).not.toHaveProperty("content.0.text", expect.stringContaining("documents"));
    await flush();
    expect(t.redeemed).toEqual([]); // the claim is redeemed only after a call the host admitted
    t.hosts[H1.url].state.gate = undefined;
    expect(titles(await t.call("list_documents"))).toEqual(["H1"]);
    await flush();
    expect(t.redeemed).toEqual([H1.url]);
  });

  it("authorization-denied → the adapter keeps working solo and does not ask that host launch again", async () => {
    const t = setup();
    t.hosts[H1.url].state.gate = "authorization-denied";
    await t.start();
    t.setLive(H1);
    const r = await t.call("list_documents");
    expect(r).toMatchObject({ ok: false, code: "authorization-denied" });
    expect(String(r.note)).toContain("単独");
    const next = await t.call("get_project_info"); // answered by solo (its usual no-deck answer), not the host
    expect(String(next.code ?? "")).not.toMatch(/^authorization-/);
    expect(next).not.toHaveProperty("note");
    expect(t.attach).toHaveBeenCalledTimes(1);
  });

  it("authorization-revoked → the secret is dropped and the adapter applies again", async () => {
    const t = setup();
    await t.start();
    t.setLive(H1);
    await t.call("list_documents");
    t.hosts[H1.url].state.gate = "authorization-revoked";
    const r = await t.call("list_documents");
    expect(r).toMatchObject({ ok: false, code: "authorization-revoked" });
    expect(String(r.note)).toContain("申し込み直しました");
    await flush();
    expect(t.forgot).toEqual([H1.url]);
    expect(t.attach).toHaveBeenCalledTimes(2);
  });
});
