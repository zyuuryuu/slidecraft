/**
 * host-server.test.ts — buildServer in HOST mode (multi-doc + server-side undo) over an in-memory
 * MCP client. Single connection (InMemoryTransport has no sessionId, so per-connection isolation
 * across MULTIPLE clients is a P2.2 concern — here one client drives one active-doc context).
 * Proves: new_project MINTS a doc (+ active + documentOpened); deck tools resolve the active/sole
 * doc and mutations bump rev; undo/redo roll the truth; select_document switches; close_document
 * guards dirty; list_documents honours private-by-default.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { DocRegistry, type HostContext, type DocEntry } from "../src/mcp/host-core";

let templateB64: string;
beforeAll(() => {
  const tBytes = readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx"));
  templateB64 = tBytes.toString("base64");
});

function makeHost(sharedOnly = false) {
  const registry = new DocRegistry();
  let activeDocId: string | undefined;
  const opened: DocEntry[] = [];
  const closed: string[] = [];
  const host: HostContext = {
    registry,
    active: () => activeDocId,
    setActive: (_e, id) => { activeDocId = id; },
    sharedOnly,
    notifyOpened: (e) => opened.push(e),
    notifyClosed: (id) => closed.push(id),
  };
  return { host, registry, opened, closed, getActive: () => activeDocId };
}

async function connect(host: HostContext): Promise<Client> {
  const server = buildServer(createSession(null), { host });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

type CallRes = { content: Array<{ text?: string }>; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as unknown as CallRes;
  const text = res.content[0]?.text ?? "null";
  return res.isError ? { data: text as unknown, isError: true } : { data: JSON.parse(text) as unknown, isError: false };
}

const NEW_MD = "# 表紙\n\n---\n\n# 中身\n\n- 速度: 0.8秒\n- 重量: 1.2kg";

describe("buildServer host mode — multi-doc lifecycle", () => {
  it("new_project MINTS a doc (active + documentOpened) and list_documents shows it", async () => {
    const h = makeHost();
    const client = await connect(h.host);
    const r = (await call(client, "new_project", { templateBase64: templateB64, markdown: NEW_MD })).data as { docId: string; slideCount: number };
    expect(r.docId).toBeTruthy();
    expect(r.slideCount).toBeGreaterThan(1);
    expect(h.opened.map((e) => e.docId)).toEqual([r.docId]);
    expect(h.getActive()).toBe(r.docId);
    const list = (await call(client, "list_documents")).data as { documents: { docId: string }[]; activeDocId: string };
    expect(list.documents.map((d) => d.docId)).toEqual([r.docId]);
    expect(list.activeDocId).toBe(r.docId);
  });

  it("deck tools resolve the SOLE doc with no select, and a mutation bumps rev", async () => {
    const h = makeHost();
    const client = await connect(h.host);
    const { docId } = (await call(client, "new_project", { templateBase64: templateB64, markdown: NEW_MD })).data as { docId: string };
    // no select_document → resolves the sole open doc
    const md = (await call(client, "get_slide_markdown", { index: 1 })).data as string;
    expect(md).toContain("速度");
    const applied = (await call(client, "set_slide_markdown", { index: 0, markdown: "# 差替\n\n- 一点" })).data as { ok: boolean; rev: number; docId: string };
    expect(applied.ok).toBe(true);
    expect(applied.rev).toBe(1); // first commit on a freshly-minted doc
    expect(applied.docId).toBe(docId);
  });

  it("server-side undo/redo roll the doc's truth and mint forward revs", async () => {
    const h = makeHost();
    const client = await connect(h.host);
    await call(client, "new_project", { templateBase64: templateB64, markdown: NEW_MD });
    await call(client, "set_slide_markdown", { index: 0, markdown: "# 差替\n\n- 一点" }); // rev 1
    const u = (await call(client, "undo")).data as { ok: boolean; rev: number; canRedo: boolean };
    expect(u.ok).toBe(true);
    expect(u.rev).toBe(2); // forward-only
    expect(u.canRedo).toBe(true);
    const back = (await call(client, "get_slide_markdown", { index: 0 })).data as string;
    expect(back).not.toContain("差替"); // truth rolled back
    const rd = (await call(client, "redo")).data as { ok: boolean; rev: number };
    expect(rd.rev).toBe(3);
  });

  it("select_document switches the connection's target doc", async () => {
    const h = makeHost();
    const client = await connect(h.host);
    const a = (await call(client, "new_project", { templateBase64: templateB64, markdown: "# A だけ" })).data as { docId: string };
    const b = (await call(client, "new_project", { templateBase64: templateB64, markdown: NEW_MD })).data as { docId: string };
    expect(h.getActive()).toBe(b.docId); // new_project set active to the latest
    await call(client, "select_document", { docId: a.docId });
    expect(h.getActive()).toBe(a.docId);
    // an explicit docId override targets b without changing the active selection back
    const onB = (await call(client, "set_slide_markdown", { index: 0, markdown: "# B 編集\n\n- x", docId: b.docId })).data as { docId: string };
    expect(onB.docId).toBe(b.docId);
    expect(h.getActive()).toBe(a.docId);
  });

  it("close_document refuses a dirty doc without force, then closes with force (+ notify)", async () => {
    const h = makeHost();
    const client = await connect(h.host);
    const { docId } = (await call(client, "new_project", { templateBase64: templateB64, markdown: NEW_MD })).data as { docId: string };
    await call(client, "set_slide_markdown", { index: 0, markdown: "# 差替\n\n- 一点" }); // dirties it
    const refused = (await call(client, "close_document", { docId })).data as { ok: boolean; dirty: boolean };
    expect(refused.ok).toBe(false);
    expect(refused.dirty).toBe(true);
    const forced = (await call(client, "close_document", { docId, force: true })).data as { ok: boolean; closed: boolean };
    expect(forced.closed).toBe(true);
    expect(h.closed).toEqual([docId]);
  });

  it("list_documents honours private-by-default (sharedOnly hides a human-private doc)", async () => {
    const h = makeHost(true); // an AI client view
    const client = await connect(h.host);
    const shared = (await call(client, "new_project", { templateBase64: templateB64, markdown: NEW_MD })).data as { docId: string };
    // a human-private doc added directly to the registry (the GUI side, not via the AI's new_project)
    const priv = h.registry.create(createSession(null), "private", false);
    const list = (await call(client, "list_documents")).data as { documents: { docId: string }[] };
    const ids = list.documents.map((d) => d.docId);
    expect(ids).toContain(shared.docId);
    expect(ids).not.toContain(priv.docId);
  });
});
