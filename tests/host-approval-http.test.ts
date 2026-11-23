/**
 * host-approval-http.test.ts — #727 (ADR-0040 D1/D3) over REAL loopback HTTP: the always-on host only lets an
 * AI client CALL tools after the human allowed it in the GUI. The GUI (GUI token) answers through its own
 * tools (list/decide/load/revoke_client_approval…), so no self-declared header can approve anything.
 * Also: the seed wait (an allowed AI's first call is held until the GUI's deck is on the host → else
 * `host-not-ready`; a failed seed passes with a `note`), and the loopback-only bind.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createCollabHost, type CollabHost, type CollabHostOptions } from "../src/mcp/host";
import { proofFor, type ApprovalView } from "../src/mcp/host-approval";
import { hostOptionsFromEnv, resolveBindHost } from "../src/mcp/host-options";

let host: CollabHost | undefined;
const clients: Client[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) { try { await c.close(); } catch { /* ignore */ } }
  await host?.close();
  host = undefined;
});

const start = async (o: CollabHostOptions = {}): Promise<CollabHost> => (host = await createCollabHost({ port: 0, hostJsonPath: null, approvalWaitMs: 50, seedWaitMs: 50, ...o }));
const connect = async (token: string, info = { name: "Cursor", version: "1.2.3" }, headers: Record<string, string> = {}): Promise<Client> => {
  const c = new Client(info);
  await c.connect(new StreamableHTTPClientTransport(new URL(host!.url), { requestInit: { headers: { Authorization: `Bearer ${token}`, ...headers } } }));
  clients.push(c);
  return c;
};
const call = async (c: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
  JSON.parse(((await c.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;
const approvals = async (gui: Client) => (await call(gui, "list_client_approvals")) as unknown as ApprovalView & { aiActive: boolean };

describe("HTTP direct: approval is bound to the mcp-session-id (D3-7)", () => {
  it("an unapproved AI's tool call is authorization-pending; after [許可] in the GUI it passes", async () => {
    await start();
    const gui = await connect(host!.guiToken);
    const ai = await connect(host!.token);
    expect(await call(ai, "list_documents")).toMatchObject({ ok: false, code: "authorization-pending" });
    const [req] = (await approvals(gui)).pending;
    expect(req).toMatchObject({ name: "Cursor", version: "1.2.3", kind: "session" });
    expect(await call(gui, "decide_client_approval", { requestId: req.requestId, decision: "allow" })).toMatchObject({ ok: true });
    expect(await call(ai, "list_documents")).toHaveProperty("documents");
  });

  it("a call made while the dialog is open waits and continues once the human allows", async () => {
    await start({ approvalWaitMs: 5_000 });
    const gui = await connect(host!.guiToken);
    const ai = await connect(host!.token);
    const pending = call(ai, "list_documents");
    let req: string | undefined;
    for (let i = 0; i < 100 && !req; i++) { req = (await approvals(gui)).pending[0]?.requestId; if (!req) await new Promise((r) => setTimeout(r, 20)); }
    await call(gui, "decide_client_approval", { requestId: req!, decision: "allow" });
    expect(await pending).toHaveProperty("documents");
  });

  it("[拒否] → authorization-denied; another session of the same client must ask again (not inherited)", async () => {
    await start();
    const gui = await connect(host!.guiToken);
    const a1 = await connect(host!.token);
    await call(gui, "decide_client_approval", { requestId: (await approvals(gui)).pending[0].requestId, decision: "deny" });
    expect(await call(a1, "list_documents")).toMatchObject({ ok: false, code: "authorization-denied" });
    const a2 = await connect(host!.token);
    expect(await call(a2, "list_documents")).toMatchObject({ ok: false, code: "authorization-pending" });
  });

  it("an approved session does not approve a NEW session of the same client", async () => {
    await start();
    const gui = await connect(host!.guiToken);
    const a1 = await connect(host!.token);
    await call(gui, "decide_client_approval", { requestId: (await approvals(gui)).pending[0].requestId, decision: "allow" });
    const a2 = await connect(host!.token);
    expect(await call(a1, "list_documents")).toHaveProperty("documents");
    expect(await call(a2, "list_documents")).toMatchObject({ ok: false, code: "authorization-pending" });
  });

  it("[取り消し] → the next call is authorization-revoked", async () => {
    await start();
    const gui = await connect(host!.guiToken);
    const ai = await connect(host!.token);
    await call(gui, "decide_client_approval", { requestId: (await approvals(gui)).pending[0].requestId, decision: "allow" });
    const [g] = (await approvals(gui)).grants;
    expect(await call(gui, "revoke_client_approval", { key: g.key })).toMatchObject({ ok: true });
    expect(await call(ai, "list_documents")).toMatchObject({ ok: false, code: "authorization-revoked" });
  });

  it("with 3 requests waiting, a 4th client is denied without a dialog", async () => {
    await start();
    const gui = await connect(host!.guiToken);
    const ais = [];
    for (let i = 0; i < 4; i++) ais.push(await connect(host!.token, { name: `c${i}`, version: "1" }));
    expect((await approvals(gui)).pending).toHaveLength(3);
    expect(await call(ais[3], "list_documents")).toMatchObject({ ok: false, code: "authorization-denied" });
  });

  it("the GUI is never asked about itself, and the approval tools are not on the AI's surface", async () => {
    await start();
    const gui = await connect(host!.guiToken);
    expect(await call(gui, "list_documents")).toHaveProperty("documents");
    expect((await approvals(gui)).pending).toHaveLength(0);
    const ai = await connect(host!.token);
    const names = (await ai.listTools()).tools.map((t) => t.name);
    for (const n of ["list_client_approvals", "decide_client_approval", "load_client_grants", "revoke_client_approval", "report_seed"]) expect(names).not.toContain(n);
  });
});

describe("stdio adapter: claim once, then prove with an HMAC over a nonce (D3-4)", () => {
  const post = async (path: string, body: unknown): Promise<Response> =>
    fetch(new URL(path, host!.url), { method: "POST", headers: { Authorization: `Bearer ${host!.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const CID = "adapter-client-0001";
  const CD = { name: "Claude Desktop", version: "0.9.0" };

  it("apply with a claim → allow → redeem the secret once → a later session proves it and is approved without a dialog", async () => {
    await start();
    const gui = await connect(host!.guiToken);
    const a1 = await connect(host!.token, CD, { "x-slidecraft-client-id": CID, "x-slidecraft-client-claim": "one-time-claim" });
    const [req] = (await approvals(gui)).pending;
    expect(req).toMatchObject({ kind: "adapter", fingerprint: CID.slice(0, 8) });
    const decided = (await call(gui, "decide_client_approval", { requestId: req.requestId, decision: "allow" })) as { grant: { secret: string; clientId: string } };
    expect(decided.grant.clientId).toBe(CID); // the GUI persists this in the keychain
    expect(await call(a1, "list_documents")).toHaveProperty("documents");

    const r = await post("/auth/claim", { clientId: CID, claim: "one-time-claim" });
    expect(r.status).toBe(200);
    const { secret } = (await r.json()) as { secret: string };
    expect(secret).toBe(decided.grant.secret);
    expect((await post("/auth/claim", { clientId: CID, claim: "one-time-claim" })).status).toBe(404); // one-time

    const { nonce } = (await (await post("/auth/nonce", {})).json()) as { nonce: string };
    const a2 = await connect(host!.token, CD, { "x-slidecraft-client-id": CID, "x-slidecraft-client-nonce": nonce, "x-slidecraft-client-proof": proofFor(secret, nonce, CID, CD) });
    expect(await call(a2, "list_documents")).toHaveProperty("documents");
    expect((await approvals(gui)).pending).toHaveLength(0);
  });

  it("a wrong HMAC is not approved (it becomes a dialog, default deny)", async () => {
    await start();
    const gui = await connect(host!.guiToken);
    await call(gui, "load_client_grants", { grants: [{ ...CD, clientId: CID, secret: "kept-in-keychain" }] });
    const { nonce } = (await (await post("/auth/nonce", {})).json()) as { nonce: string };
    const ai = await connect(host!.token, CD, { "x-slidecraft-client-id": CID, "x-slidecraft-client-nonce": nonce, "x-slidecraft-client-proof": proofFor("guessed", nonce, CID, CD) });
    expect(await call(ai, "list_documents")).toMatchObject({ ok: false, code: "authorization-pending" });
  });

  it("grants handed over by the GUI (keychain) approve a correct HMAC from a new launch", async () => {
    await start();
    const gui = await connect(host!.guiToken);
    await call(gui, "load_client_grants", { grants: [{ ...CD, clientId: CID, secret: "kept-in-keychain" }] });
    const { nonce } = (await (await post("/auth/nonce", {})).json()) as { nonce: string };
    const ai = await connect(host!.token, CD, { "x-slidecraft-client-id": CID, "x-slidecraft-client-nonce": nonce, "x-slidecraft-client-proof": proofFor("kept-in-keychain", nonce, CID, CD) });
    expect(await call(ai, "list_documents")).toHaveProperty("documents");
  });

  it("a malformed client id is refused at the door (400)", async () => {
    await start();
    await expect(connect(host!.token, CD, { "x-slidecraft-client-id": "bad id with spaces" })).rejects.toThrow();
  });

  it("the auth endpoints still require the shared token", async () => {
    await start();
    const r = await fetch(new URL("/auth/nonce", host!.url), { method: "POST" });
    expect(r.status).toBe(401);
  });
});

describe("seed wait: the GUI's deck is on the host before an allowed AI sees it (D1)", () => {
  const allowedAi = async (gui: Client): Promise<Client> => {
    const ai = await connect(host!.token);
    await call(ai, "list_documents"); // applies
    await call(gui, "decide_client_approval", { requestId: (await approvals(gui)).pending[0].requestId, decision: "allow" });
    return ai;
  };

  it("while the GUI's seed is pending and does not finish in time → host-not-ready (never an empty host)", async () => {
    await start();
    const gui = await connect(host!.guiToken);
    await call(gui, "report_seed", { state: "pending" });
    const ai = await allowedAi(gui);
    expect(await call(ai, "list_documents")).toMatchObject({ ok: false, code: "host-not-ready" });
    expect((await approvals(gui)).aiActive).toBe(true); // the GUI was asked to seed (and to lock its edits)
  });

  it("a call that arrives during the seed waits and passes once the GUI reports done", async () => {
    await start({ seedWaitMs: 5_000 });
    const gui = await connect(host!.guiToken);
    await call(gui, "report_seed", { state: "pending" });
    const ai = await allowedAi(gui);
    const held = call(ai, "list_documents");
    await new Promise((r) => setTimeout(r, 50));
    await call(gui, "report_seed", { state: "done" });
    expect(await held).toHaveProperty("documents");
  });

  it("a failed seed lets the call through and says so in `note`", async () => {
    await start();
    const gui = await connect(host!.guiToken);
    await call(gui, "report_seed", { state: "pending" });
    const ai = await allowedAi(gui);
    await call(gui, "report_seed", { state: "failed", error: "template too large" });
    const r = await call(ai, "list_documents");
    expect(r).toHaveProperty("documents");
    expect(String(r.note)).toContain("GUI");
  });

  it("aiActive stays false while no allowed AI has called (the GUI keeps editing — editLocked off)", async () => {
    await start();
    const gui = await connect(host!.guiToken);
    const ai = await connect(host!.token);
    await call(ai, "list_documents"); // pending, not allowed
    expect((await approvals(gui)).aiActive).toBe(false);
  });
});

describe("loopback only (統括補記 2026-11-23): the host never binds beyond 127.0.0.1", () => {
  it("the live listener's address is 127.0.0.1", async () => {
    await start();
    expect(new URL(host!.url).hostname).toBe("127.0.0.1");
  });

  it("any non-loopback bind request is refused (0.0.0.0 / :: / LAN / hostname)", async () => {
    for (const h of ["0.0.0.0", "::", "192.168.1.10", "10.0.0.5", "example.com", ""]) {
      expect(() => resolveBindHost(h)).toThrow();
      await expect(createCollabHost({ port: 0, hostJsonPath: null, host: h })).rejects.toThrow();
    }
    expect(resolveBindHost(undefined)).toBe("127.0.0.1");
    expect(resolveBindHost("127.0.0.1")).toBe("127.0.0.1");
  });

  it("no environment variable moves the bind address (the sidecar reads only port / host.json / metrics)", () => {
    const o = hostOptionsFromEnv({ SLIDECRAFT_PORT: "0", SLIDECRAFT_HOST: "0.0.0.0", HOST: "0.0.0.0", SLIDECRAFT_BIND: "0.0.0.0", BIND_ADDRESS: "0.0.0.0" });
    expect(o.host).toBeUndefined();
    expect(Object.keys(o).sort()).toEqual(["hostJsonPath", "metricsPath", "port"]);
  });
});
