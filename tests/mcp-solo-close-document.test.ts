/**
 * mcp-solo-close-document.test.ts — #728 (ADR-0040 D2): the solo surface also offers close_document, so an AI can
 * put down its solo deck and let the adapter connect to the GUI's host. No new tool: the existing rule applies —
 * an unsaved deck needs `force` (never-silent). After closing, solo is back in its startup state (one doc, no
 * deck), which is what the adapter's "deck open?" check (host-core openDeckDocId) reads.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSession } from "../src/mcp/session";
import { buildServer } from "../src/mcp/server";
import { createSoloHostContext, openDeckDocId } from "../src/mcp/host-core";

const templateB64 = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")).toString("base64");

async function solo() {
  const session = createSession(null);
  const host = createSoloHostContext(session);
  const server = buildServer(session, { host, registerResources: true });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    JSON.parse(((await client.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;
  return { host, client, call };
}

describe("solo close_document (ADR-0040 D2)", () => {
  it("is on the solo tools/list", async () => {
    const { client } = await solo();
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("close_document");
  });

  it("the solo server announces tools.listChanged (the adapter tells the AI when it switches)", async () => {
    const { client } = await solo();
    expect(client.getServerCapabilities()?.tools?.listChanged).toBe(true);
  });

  it("an unsaved deck needs force; then solo is back to one doc without a deck", async () => {
    const { host, call } = await solo();
    expect(openDeckDocId(host.registry)).toBeNull(); // startup: no deck
    const opened = await call("new_project", { templateBase64: templateB64, markdown: "# A\n\n- x" });
    const docId = opened.docId as string;
    expect(openDeckDocId(host.registry)).toBe(docId);

    expect(await call("close_document", { docId })).toEqual({ ok: false, closed: false, dirty: true });
    expect(openDeckDocId(host.registry)).toBe(docId); // refused = nothing dropped

    expect(await call("close_document", { docId, force: true })).toEqual({ ok: true, closed: true });
    expect(openDeckDocId(host.registry)).toBeNull();
    expect(host.registry.size).toBe(1); // still exactly one doc (sole-doc resolution keeps working)
    // the same never-silent "no project" answer as right after startup
    const info = await call("get_project_info");
    expect(JSON.stringify(info)).not.toContain(docId);
  });

  it("a saved deck closes without force", async () => {
    const { host, call } = await solo();
    const { docId } = (await call("new_project", { templateBase64: templateB64, markdown: "# A" })) as { docId: string };
    await call("save_project");
    expect(await call("close_document", { docId })).toEqual({ ok: true, closed: true });
    expect(openDeckDocId(host.registry)).toBeNull();
  });

  it("after closing, a new deck can be opened again (solo keeps working)", async () => {
    const { host, call } = await solo();
    const { docId } = (await call("new_project", { templateBase64: templateB64, markdown: "# A" })) as { docId: string };
    await call("close_document", { docId, force: true });
    const again = await call("new_project", { templateBase64: templateB64, markdown: "# B" });
    expect(openDeckDocId(host.registry)).toBe(again.docId);
    expect(host.registry.size).toBe(1);
  });
});
