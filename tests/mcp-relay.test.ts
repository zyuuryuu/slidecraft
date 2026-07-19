/**
 * mcp-relay.test.ts — ADR-0033 D2 forward mode: `runRelay` driven entirely in-memory (no real
 * sockets, no subprocess). The "remote" side is a REAL host-mode `buildServer` (the same production
 * code path host.ts wires over HTTP) sharing one `DocRegistry` + a broadcast hook across TWO
 * connections — one standing in for "the human GUI already editing", one for the relay's remote
 * end — exactly mirroring host.ts's one-McpServer-per-connection, shared-registry shape. Proves the
 * relay is a transparent pass-through: the AI (reached ONLY through `runRelay`) sees the human's
 * shared doc via `list_documents`, and a host-side edit's `deckChanged` notification reaches the AI
 * — without the relay ever holding deck state itself.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/server";
import { createSession } from "../src/mcp/session";
import { DocRegistry, type HostContext } from "../src/mcp/host-core";
import { runRelay } from "../src/mcp/mcp-relay";
import type { HostHandshake } from "../src/mcp/host-json";

type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as unknown as CallRes;
  return JSON.parse(res.content[0]?.text ?? "null") as unknown;
}

let templateB64: string;
beforeAll(() => {
  templateB64 = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")).toString("base64");
});

/** A minimal in-memory stand-in for host.ts's shared registry + broadcast (same shape, same
 *  `notifications/slidecraft/deckChanged` method name) — no real HTTP/sockets, so this connects
 *  multiple independent `buildServer` instances (one per "connection") the same way host.ts does. */
function makeSharedHost() {
  const registry = new DocRegistry();
  const servers: { server: { notification(n: { method: string; params: Record<string, unknown> }): Promise<void> } }[] = [];
  const makeCtx = (sharedOnly: boolean): HostContext => ({
    registry,
    active: () => undefined,
    setActive: () => {},
    sharedOnly,
    onMutated: (entry, _tool, opId) => {
      for (const s of servers) void s.server.notification({ method: "notifications/slidecraft/deckChanged", params: { docId: entry.docId, rev: entry.rev, opId } }).catch(() => {});
    },
  });
  return { registry, servers, makeCtx };
}

describe("runRelay — transparent forward over a shared host registry (in-memory)", () => {
  it("the relayed AI sees the human's shared doc, and the host's deckChanged reaches the AI", async () => {
    const shared = makeSharedHost();

    // "the human GUI already editing": its own McpServer + connection, sharedOnly:false.
    const guiServer = buildServer(createSession(null), { host: shared.makeCtx(false), registerResources: false });
    shared.servers.push(guiServer as unknown as { server: { notification(n: { method: string; params: Record<string, unknown> }): Promise<void> } });
    const [guiClientTransport, guiServerTransport] = InMemoryTransport.createLinkedPair();
    await guiServer.connect(guiServerTransport);
    const gui = new Client({ name: "gui", version: "1.0.0" });
    await gui.connect(guiClientTransport);

    // The relay's REMOTE end: its own McpServer + connection, sharedOnly:true (an AI-role connection).
    const remoteServer = buildServer(createSession(null), { host: shared.makeCtx(true), registerResources: false });
    shared.servers.push(remoteServer as unknown as { server: { notification(n: { method: string; params: Record<string, unknown> }): Promise<void> } });
    const [remoteTransport, remoteServerTransport] = InMemoryTransport.createLinkedPair();
    await remoteServer.connect(remoteServerTransport);

    // runRelay wires the AI-facing "local" side to that remote — `handshake` is unused since `remote` is injected.
    const unusedHandshake: HostHandshake = { url: "unused://", token: "unused", pid: process.pid, startedAt: new Date().toISOString() };
    const [aiClientTransport, localTransport] = InMemoryTransport.createLinkedPair();
    const relayDone = runRelay(unusedHandshake, localTransport, remoteTransport);
    const ai = new Client({ name: "ai", version: "1.0.0" });
    const deckChanged: unknown[] = [];
    ai.fallbackNotificationHandler = async (n) => {
      if (n.method.endsWith("deckChanged")) deckChanged.push(n.params);
    };
    await ai.connect(aiClientTransport);

    // The human mints a shared doc (new_project always marks shared:true, regardless of role).
    const made = (await call(gui, "new_project", { templateBase64: templateB64, markdown: "# A\n\n---\n\n# B\n\n- x" })) as { docId: string };

    // The AI, reached ONLY through the relay, sees the human's doc.
    const list = (await call(ai, "list_documents")) as { documents: { docId: string }[] };
    expect(list.documents.map((d) => d.docId)).toContain(made.docId);

    // The human's edit fires deckChanged; it must reach the AI over the relay's pass-through.
    await gui.callTool({ name: "set_slide_markdown", arguments: { index: 0, markdown: "# 差替\n\n- z", docId: made.docId } });
    const start = Date.now();
    while (deckChanged.length === 0 && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 10));
    expect(deckChanged.length).toBeGreaterThan(0);
    expect((deckChanged[0] as { docId: string }).docId).toBe(made.docId);

    await ai.close();
    await gui.close();
    await relayDone;
  });
});

describe("the relay holds NO deck state (ADR-0033: forward can never become a second control plane)", () => {
  it("mcp-relay.ts never imports host-core (DocRegistry/commitMutation) or session.ts", () => {
    const src = readFileSync(resolve(__dirname, "../src/mcp/mcp-relay.ts"), "utf8");
    expect(src).not.toMatch(/from ["']\.\/host-core["']/);
    expect(src).not.toMatch(/from ["']\.\/session["']/);
  });
});
