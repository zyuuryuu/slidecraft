/**
 * host-http.test.ts — the P2 collab listener over REAL loopback HTTP (no GUI). Two MCP clients
 * connect via Streamable HTTP; proves a wrong token is refused, two clients share ONE registry,
 * and a mutation by one client FANS OUT deckChanged / documentOpened to the other over its SSE leg.
 * (Per-connection active-doc isolation across clients needs the real mcpSessionId, which THIS test
 * has — unlike the in-memory host-server.test.ts.)
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createCollabHost, type CollabHost } from "../src/mcp/host";

let templateB64: string;
beforeAll(() => {
  templateB64 = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")).toString("base64");
});

let host: CollabHost;
const clients: Client[] = [];
beforeEach(async () => {
  host = await createCollabHost({ port: 0, hostJsonPath: null }); // ephemeral, no handshake file
});
afterEach(async () => {
  for (const c of clients.splice(0)) {
    try { await c.close(); } catch { /* ignore */ }
  }
  await host.close();
});

async function connect(token = host.token): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(host.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const c = new Client({ name: "test", version: "1.0.0" });
  await c.connect(transport);
  clients.push(c);
  return c;
}

type Notif = { method: string; params?: Record<string, unknown> };
async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for a condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("collab host over loopback HTTP", () => {
  it("refuses a wrong bearer token (connect fails)", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(host.url), { requestInit: { headers: { Authorization: "Bearer wrong" } } });
    const c = new Client({ name: "bad", version: "1.0.0" });
    await expect(c.connect(transport)).rejects.toThrow();
  });

  it("two clients share ONE registry (a doc created by A is listed by B)", async () => {
    const a = await connect();
    const b = await connect();
    const made = (await a.callTool({ name: "new_project", arguments: { templateBase64: templateB64, markdown: "# A\n\n---\n\n# B\n\n- x" } })) as unknown as { content: { text: string }[] };
    const docId = (JSON.parse(made.content[0].text) as { docId: string }).docId;

    const listed = (await b.callTool({ name: "list_documents" })) as unknown as { content: { text: string }[] };
    const docs = (JSON.parse(listed.content[0].text) as { documents: { docId: string }[] }).documents;
    expect(docs.map((d) => d.docId)).toContain(docId);
  });

  it("a mutation by A fans out documentOpened + deckChanged to B over its SSE leg", async () => {
    const b = await connect();
    const got: Notif[] = [];
    b.fallbackNotificationHandler = async (n) => { got.push(n as Notif); };
    await new Promise((r) => setTimeout(r, 100)); // let B's standalone GET SSE stream establish

    const a = await connect();
    await a.callTool({ name: "new_project", arguments: { templateBase64: templateB64, markdown: "# A\n\n---\n\n# B\n\n- x" } });
    await waitFor(() => got.some((n) => n.method === "notifications/slidecraft/documentOpened"));

    await a.callTool({ name: "set_slide_markdown", arguments: { index: 0, markdown: "# 差替\n\n- z" } });
    await waitFor(() => got.some((n) => n.method === "notifications/slidecraft/deckChanged"));

    const changed = got.find((n) => n.method === "notifications/slidecraft/deckChanged");
    expect(changed?.params?.rev).toBe(1); // first commit on the minted doc
  });
});
