/**
 * collab-approvals.test.ts — #727: the GUI's approval channel (src/ipc/collab-approvals.ts) against a REAL host.
 * It is a second GUI-token connection next to the deck projection: it learns about waiting AI clients (push,
 * with a poll floor), answers them, hands the keychain grants over, and reports when an allowed AI started
 * calling (aiActive → the GUI seeds its deck and locks its edits).
 */
import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import { CollabApprovals, type ApprovalSnapshot } from "../src/ipc/collab-approvals";

let host: CollabHost | undefined;
let chan: CollabApprovals | undefined;
const clients: Client[] = [];
afterEach(async () => {
  await chan?.stop();
  chan = undefined;
  for (const c of clients.splice(0)) { try { await c.close(); } catch { /* ignore */ } }
  await host?.close();
  host = undefined;
});

const until = async (pred: () => boolean, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};
const aiConnect = async (headers: Record<string, string> = {}): Promise<Client> => {
  const c = new Client({ name: "Cursor", version: "9" });
  await c.connect(new StreamableHTTPClientTransport(new URL(host!.url), { requestInit: { headers: { Authorization: `Bearer ${host!.token}`, ...headers } } }));
  clients.push(c);
  return c;
};
const callText = async (c: Client) => ((await c.callTool({ name: "list_documents", arguments: {} })) as { content: { text: string }[] }).content[0].text;

describe("CollabApprovals", () => {
  it("sees a waiting client, allows it, and reports aiActive once the allowed AI calls", async () => {
    host = await createCollabHost({ port: 0, hostJsonPath: null, approvalWaitMs: 5_000, seedWaitMs: 50 });
    const views: ApprovalSnapshot[] = [];
    let active = 0;
    chan = new CollabApprovals({ url: host.url, guiToken: host.guiToken, pollMs: 0, onView: (v) => views.push(v), onAiActive: () => active++ });
    await chan.start();
    const ai = await aiConnect();
    const held = callText(ai); // waits for the human
    await until(() => (views.at(-1)?.pending.length ?? 0) === 1); // pushed (poll disabled)
    const req = views.at(-1)!.pending[0];
    expect(req.name).toBe("Cursor");
    await chan.decide(req.requestId, "allow");
    expect(JSON.parse(await held)).toHaveProperty("documents");
    await until(() => active === 1);
    expect(views.at(-1)!.aiActive).toBe(true);
  });

  it("allowing an adapter returns the grant to keep; loadGrants hands kept grants back to a new host", async () => {
    host = await createCollabHost({ port: 0, hostJsonPath: null, approvalWaitMs: 50, seedWaitMs: 50 });
    chan = new CollabApprovals({ url: host.url, guiToken: host.guiToken, pollMs: 0, onView: () => {}, onAiActive: () => {} });
    await chan.start();
    await aiConnect({ "x-slidecraft-client-id": "adapter-client-0001", "x-slidecraft-client-claim": "c" });
    const v = await chan.refresh();
    const grant = await chan.decide(v.pending[0].requestId, "allow");
    expect(grant).toMatchObject({ clientId: "adapter-client-0001", name: "Cursor", version: "9" });
    await chan.loadGrants([grant!]);
    expect((await chan.refresh()).grants).toHaveLength(1);
  });

  it("revoke reaches the host (the next AI call is authorization-revoked)", async () => {
    host = await createCollabHost({ port: 0, hostJsonPath: null, approvalWaitMs: 50, seedWaitMs: 50 });
    chan = new CollabApprovals({ url: host.url, guiToken: host.guiToken, pollMs: 0, onView: () => {}, onAiActive: () => {} });
    await chan.start();
    const ai = await aiConnect();
    await chan.decide((await chan.refresh()).pending[0].requestId, "allow");
    await chan.revoke((await chan.refresh()).grants[0].key);
    expect(JSON.parse(await callText(ai))).toMatchObject({ code: "authorization-revoked" });
  });

  it("the poll floor finds a waiting client even if the push never arrives", async () => {
    host = await createCollabHost({ port: 0, hostJsonPath: null, approvalWaitMs: 50 });
    const views: ApprovalSnapshot[] = [];
    chan = new CollabApprovals({ url: host.url, guiToken: host.guiToken, pollMs: 30, onView: (v) => views.push(v), onAiActive: () => {} });
    await chan.start();
    await aiConnect();
    await until(() => (views.at(-1)?.pending.length ?? 0) === 1);
  });
});
