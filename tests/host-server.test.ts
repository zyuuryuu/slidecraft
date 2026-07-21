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
import { DocRegistry, MemTemplateStore, type HostContext, type DocEntry, type TemplateStore } from "../src/mcp/host-core";

let templateB64: string;
beforeAll(() => {
  const tBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
  templateB64 = tBytes.toString("base64");
});

function makeHost(sharedOnly = false, templates?: TemplateStore, registry = new DocRegistry(), solo = false) {
  let activeDocId: string | undefined;
  const opened: DocEntry[] = [];
  const closed: string[] = [];
  const host: HostContext = {
    registry,
    active: () => activeDocId,
    setActive: (_e, id) => { activeDocId = id; },
    sharedOnly,
    templates,
    solo,
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

describe("buildServer host mode — template selection (S2 増分2)", () => {
  it("register_templates (GUI) → list_templates → use_template MINTS a doc titled after the template", async () => {
    const store = new MemTemplateStore();
    const h = makeHost(false, store); // gui role
    const client = await connect(h.host);
    const reg = (await call(client, "register_templates", { templates: [{ id: "m1", name: "社内テンプレ", builtin: false, bytesBase64: templateB64 }] })).data as { ok: boolean; count: number };
    expect(reg.ok).toBe(true);
    expect(reg.count).toBe(1);
    const list = (await call(client, "list_templates")).data as { templates: { id: string; name: string; builtin: boolean }[] };
    expect(list.templates).toEqual([{ id: "m1", name: "社内テンプレ", builtin: false }]);
    const used = (await call(client, "use_template", { id: "m1", markdown: NEW_MD })).data as { docId: string; slideCount: number };
    expect(used.docId).toBeTruthy();
    expect(used.slideCount).toBeGreaterThan(1);
    expect(h.getActive()).toBe(used.docId); // use_template selects the minted doc
    expect(h.opened.map((e) => e.title)).toEqual(["社内テンプレ"]); // tab named after the template
  });

  it("use_template with an unknown id is never-silent (ok:false, unknown-template) and mints nothing", async () => {
    const store = new MemTemplateStore();
    store.register([{ id: "m1", name: "T", builtin: false, bytes: new Uint8Array(Buffer.from(templateB64, "base64")) }]);
    const h = makeHost(false, store);
    const client = await connect(h.host);
    const r = (await call(client, "use_template", { id: "zzz" })).data as { ok: boolean; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("unknown-template");
    expect(h.opened).toEqual([]); // no doc minted
    expect(h.registry.size).toBe(0);
  });

  it("list_templates without a registry accessor guides to create_template (ok:false, template-registry-unavailable)", async () => {
    const h = makeHost(false); // no templates store injected, NOT solo (e.g. a host that didn't wire the GUI) — #298's builtin fallback must not swallow this
    const client = await connect(h.host);
    const r = (await call(client, "list_templates")).data as { ok: boolean; code: string; error: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("template-registry-unavailable");
    expect(r.error).toContain("create_template"); // 案2: imperative pivot to the solo-safe tools
    expect(r.error).toContain("new_project");
  });

  it("use_template without a registry accessor and NOT solo stays never-silent (ok:false, template-registry-unavailable)", async () => {
    const h = makeHost(false); // not solo, no templates: the collab-without-registry edge case
    const client = await connect(h.host);
    const r = (await call(client, "use_template", { id: "midnight" })).data as { ok: boolean; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("template-registry-unavailable");
    expect(h.opened).toEqual([]); // no doc minted
  });

  it("register_templates is GUI-only; an AI client can't see it but CAN list/use what the GUI registered", async () => {
    const store = new MemTemplateStore(); // ONE shared store, two connections
    const gui = makeHost(false, store);
    const ai = makeHost(true, store);
    const guiClient = await connect(gui.host);
    const aiClient = await connect(ai.host);
    // tool surface differs by role
    const guiTools = (await guiClient.listTools()).tools.map((t) => t.name);
    const aiTools = (await aiClient.listTools()).tools.map((t) => t.name);
    expect(guiTools).toContain("register_templates");
    expect(aiTools).not.toContain("register_templates");
    expect(aiTools).toContain("list_templates");
    expect(aiTools).toContain("use_template");
    // the GUI uploads; the AI sees it and can start from it
    await call(guiClient, "register_templates", { templates: [{ id: "m1", name: "共有テンプレ", builtin: false, bytesBase64: templateB64 }] });
    const seen = (await call(aiClient, "list_templates")).data as { templates: { id: string }[] };
    expect(seen.templates.map((t) => t.id)).toEqual(["m1"]);
    const used = (await call(aiClient, "use_template", { id: "m1", markdown: NEW_MD })).data as { docId: string; slideCount: number };
    expect(used.docId).toBeTruthy();
    expect(used.slideCount).toBeGreaterThan(1);
  });

  it("a solo HostContext (host.solo, no templates store) falls back to built-in presets, same as stdio's createSoloHostContext (#298)", async () => {
    const h = makeHost(false, undefined, new DocRegistry(), /* solo */ true);
    const client = await connect(h.host);
    const list = (await call(client, "list_templates")).data as { templates: { id: string; builtin: boolean }[] };
    expect(list.templates.length).toBeGreaterThan(0);
    expect(list.templates.every((t) => t.builtin)).toBe(true);
    const used = (await call(client, "use_template", { id: "midnight", markdown: NEW_MD })).data as { docId: string; slideCount: number };
    expect(used.docId).toBeTruthy();
    expect(used.slideCount).toBeGreaterThan(1);
    expect(h.opened.map((e) => e.title)).toEqual(["Midnight"]); // tab named after the built-in preset
  });

  it("a registered GUI store still wins over the built-in fallback even when host.solo is (incorrectly) set — collab truth is never shadowed", async () => {
    const store = new MemTemplateStore();
    store.register([{ id: "m1", name: "社内テンプレ", builtin: false, bytes: new Uint8Array(Buffer.from(templateB64, "base64")) }]);
    const h = makeHost(false, store, new DocRegistry(), true);
    const client = await connect(h.host);
    const list = (await call(client, "list_templates")).data as { templates: { id: string }[] };
    expect(list.templates.map((t) => t.id)).toEqual(["m1"]); // registered store, not the builtin list
  });
});
