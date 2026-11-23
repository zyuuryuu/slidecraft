/**
 * host-attach-http.test.ts — #728 (ADR-0040 D3-4) against a REAL collab host over loopback: what the adapter sends
 * is what #727's approval API accepts. First launch: apply with a client id + one-time claim → the human allows →
 * the first admitted call redeems the secret into the credential file. Next launch: prove the secret with an HMAC
 * over a fresh nonce → approved without a dialog. The secret never travels after the claim.
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import type { ApprovalView } from "../src/mcp/host-approval";
import { attachHost, type Attachment } from "../src/mcp/host-attach";
import { CredentialFile } from "../src/mcp/client-credentials";

let dir: string;
beforeAll(() => void (dir = mkdtempSync(join(tmpdir(), "slidecraft-attach-"))));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let host: CollabHost | undefined;
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c().catch(() => {});
  await host?.close();
  host = undefined;
});

const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Claude Desktop", version: "0.9.0" } };
const hs = () => ({ url: host!.url, token: host!.token, pid: 1, startedAt: "x" });

async function gui(): Promise<Client> {
  const c = new Client({ name: "gui", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(host!.url), { requestInit: { headers: { Authorization: `Bearer ${host!.guiToken}` } } }));
  closers.push(() => c.close());
  return c;
}
const guiCall = async (c: Client, name: string, args: Record<string, unknown> = {}) =>
  JSON.parse(((await c.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;

/** One tools/call over an attachment's raw wire. */
async function wireCall(att: Attachment, name: string, id: number): Promise<Record<string, unknown>> {
  const reply = new Promise<JSONRPCMessage>((res) => {
    att.wire.onmessage = (m) => {
      if ("id" in m && m.id === id) res(m);
    };
  });
  await att.wire.send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } });
  const m = (await reply) as { result: { content: { text: string }[] } };
  return JSON.parse(m.result.content[0].text) as Record<string, unknown>;
}

describe("attachHost ⇄ the #727 approval API", () => {
  it("claim → [許可] → secret saved → the next launch proves it (no second dialog)", async () => {
    host = await createCollabHost({ port: 0, hostJsonPath: null, approvalWaitMs: 50, seedWaitMs: 50 });
    const g = await gui();
    const creds = new CredentialFile(join(dir, "cd.json"));

    const a1 = await attachHost(hs(), INIT, creds);
    closers.push(() => a1.close());
    expect(await wireCall(a1, "list_documents", 1)).toMatchObject({ ok: false, code: "authorization-pending" });
    const view = (await guiCall(g, "list_client_approvals")) as unknown as ApprovalView;
    expect(view.pending).toHaveLength(1);
    expect(view.pending[0]).toMatchObject({ kind: "adapter", name: "Claude Desktop", fingerprint: creds.ensure().clientId.slice(0, 8) });
    await guiCall(g, "decide_client_approval", { requestId: view.pending[0].requestId, decision: "allow" });
    expect(await wireCall(a1, "list_documents", 2)).toHaveProperty("documents");
    await a1.afterAdmitted();
    const saved = creds.ensure();
    expect(saved.secret).toBeTruthy();
    expect(saved.version).toBe("0.9.0");
    expect(readFileSync(join(dir, "cd.json"), "utf8")).toContain(saved.clientId);

    const a2 = await attachHost(hs(), INIT, creds);
    closers.push(() => a2.close());
    expect(await wireCall(a2, "list_documents", 1)).toHaveProperty("documents");
    expect(((await guiCall(g, "list_client_approvals")) as unknown as ApprovalView).pending).toHaveLength(0);
  });

  it("a secret granted for another version is not used as proof — the adapter applies afresh with a claim", async () => {
    host = await createCollabHost({ port: 0, hostJsonPath: null, approvalWaitMs: 50, seedWaitMs: 50 });
    const g = await gui();
    const creds = new CredentialFile(join(dir, "old.json"));
    creds.ensure();
    creds.saveSecret("0.8.0", "secret-of-the-old-version");
    const a = await attachHost(hs(), INIT, creds);
    closers.push(() => a.close());
    expect(await wireCall(a, "list_documents", 1)).toMatchObject({ code: "authorization-pending" });
    const [req] = ((await guiCall(g, "list_client_approvals")) as unknown as ApprovalView).pending;
    await guiCall(g, "decide_client_approval", { requestId: req.requestId, decision: "allow" });
    await wireCall(a, "list_documents", 2);
    await a.afterAdmitted();
    expect(creds.ensure().version).toBe("0.9.0");
  });

  it("forgetSecret drops only the secret (the client id — the pair's identity — stays)", async () => {
    host = await createCollabHost({ port: 0, hostJsonPath: null });
    const creds = new CredentialFile(join(dir, "f.json"));
    const { clientId } = creds.ensure();
    creds.saveSecret("0.9.0", "s");
    const a = await attachHost(hs(), INIT, creds);
    closers.push(() => a.close());
    a.forgetSecret();
    expect(creds.ensure()).toEqual({ clientId });
  });

  it("a dead host rejects the attach (never hangs)", async () => {
    const t0 = Date.now();
    await expect(attachHost({ url: "http://127.0.0.1:9/mcp", token: "x", pid: 1, startedAt: "y" }, INIT, new CredentialFile(join(dir, "d.json")), { timeoutMs: 1000 })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
