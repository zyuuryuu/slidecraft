/**
 * host-gui-token.test.ts — #730 (ADR-0040 D3-6 / ADR-0038 D3): the collab host decides "this connection
 * is the GUI" from a GUI-ONLY token, never from the self-declared `x-slidecraft-role` header. The GUI
 * token is minted per launch next to the shared token, travels ONLY on the stdout READY line (Rust →
 * webview), and is never written to host.json. A request that NAMES itself gui without that token is
 * refused (closing the "just claim to be the GUI" path before client approval lands in #727).
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { admitRequest, mintToken, type SecurityConfig } from "../src/mcp/host-security";
import { formatReadyLine, parseReadyLine } from "../src/mcp/host-handshake";
import { createCollabHost, type CollabHost } from "../src/mcp/host";
import { createSession } from "../src/mcp/session";

const shared = mintToken();
const gui = mintToken();
const cfg: SecurityConfig = {
  token: shared,
  guiToken: gui,
  allowedOrigins: new Set(["tauri://localhost"]),
  allowedHosts: new Set(["127.0.0.1", "localhost"]),
};
const H = "127.0.0.1:5174";

describe("admitRequest: the role comes from the token, not from a header", () => {
  it("shared token + `x-slidecraft-role: gui` is NOT the GUI (refused: naming yourself is not a credential)", () => {
    const r = admitRequest({ host: H, authorization: `Bearer ${shared}`, role: "gui" }, cfg);
    expect(r).toEqual({ status: 403, message: "role header requires the gui token" });
  });

  it("any x-slidecraft-role value without the GUI token is refused (the header is not a role switch)", () => {
    expect(admitRequest({ host: H, authorization: `Bearer ${shared}`, role: "ai" }, cfg)).toEqual({ status: 403, message: "role header requires the gui token" });
  });

  it("shared token alone → admitted as AI", () => {
    expect(admitRequest({ host: H, authorization: `Bearer ${shared}` }, cfg)).toEqual({ role: "ai" });
  });

  it("GUI token → admitted as GUI (with or without the legacy header)", () => {
    expect(admitRequest({ host: H, authorization: `Bearer ${gui}` }, cfg)).toEqual({ role: "gui" });
    expect(admitRequest({ host: H, authorization: `Bearer ${gui}`, role: "gui" }, cfg)).toEqual({ role: "gui" });
  });

  it("a wrong token is not the GUI (401), even when it claims the role", () => {
    expect(admitRequest({ host: H, authorization: `Bearer ${mintToken()}` }, cfg)).toEqual({ status: 401, message: "unauthorized" });
    expect(admitRequest({ host: H, authorization: `Bearer ${mintToken()}`, role: "gui" }, cfg)).toEqual({ status: 401, message: "unauthorized" });
    expect(admitRequest({ host: H, authorization: `Bearer ${gui.slice(0, -1)}` }, cfg)).toEqual({ status: 401, message: "unauthorized" });
  });

  it("the GUI token still passes the Host / Origin belts first (no bypass)", () => {
    expect(admitRequest({ host: "evil.com", authorization: `Bearer ${gui}` }, cfg)).toMatchObject({ status: 421 });
    expect(admitRequest({ host: H, origin: "http://evil.com", authorization: `Bearer ${gui}` }, cfg)).toMatchObject({ status: 403 });
  });
});

describe("handshake: guiToken rides the READY line, never host.json", () => {
  it("READY line round-trips {url, token, guiToken}; a line without guiToken is rejected (never half-built)", () => {
    const h = { url: "http://127.0.0.1:5174/mcp", token: shared, guiToken: gui };
    const line = formatReadyLine(h);
    expect(line).toContain(gui);
    expect(parseReadyLine(line)).toEqual(h);
    expect(parseReadyLine(formatReadyLine(h).replace(/,"guiToken":"[^"]+"/, ""))).toBeNull();
  });

  let dir: string | undefined;
  let host: CollabHost | undefined;
  afterEach(async () => {
    await host?.close();
    host = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("the live host mints a distinct GUI token and host.json does NOT contain it", async () => {
    dir = mkdtempSync(join(tmpdir(), "slidecraft-guitoken-"));
    const path = join(dir, "host.json");
    host = await createCollabHost({ port: 0, hostJsonPath: path });
    expect(Buffer.from(host.guiToken, "base64url").length).toBe(32);
    expect(host.guiToken).not.toEqual(host.token);
    const raw = readFileSync(path, "utf8");
    expect(raw).toContain(host.token); // discovery for the AI still works
    expect(raw).not.toContain(host.guiToken);
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(["pid", "startedAt", "token", "url"]);
  });
});

describe("over loopback HTTP: who is the GUI", () => {
  let host: CollabHost;
  const clients: Client[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) { try { await c.close(); } catch { /* ignore */ } }
    await host.close();
  });
  const connect = async (headers: Record<string, string>): Promise<Client> => {
    const c = new Client({ name: "t", version: "1" });
    await c.connect(new StreamableHTTPClientTransport(new URL(host.url), { requestInit: { headers } }));
    clients.push(c);
    return c;
  };
  const listDocs = async (c: Client) => JSON.parse((await c.callTool({ name: "list_documents", arguments: {} }) as { content: { text: string }[] }).content[0].text) as { documents: unknown[] };

  it("the shared token + `x-slidecraft-role: gui` cannot connect", async () => {
    host = await createCollabHost({ port: 0, hostJsonPath: null });
    await expect(connect({ Authorization: `Bearer ${host.token}`, "x-slidecraft-role": "gui" })).rejects.toThrow();
  });

  it("the GUI token sees a private doc (GUI = all docs); the shared token does not (AI = shared only)", async () => {
    host = await createCollabHost({ port: 0, hostJsonPath: null, requireClientApproval: false });
    host.registry.create(createSession(null), "private", false); // a doc the human has not shared
    const g = await connect({ Authorization: `Bearer ${host.guiToken}` });
    const a = await connect({ Authorization: `Bearer ${host.token}` });
    expect((await listDocs(g)).documents).toHaveLength(1);
    expect((await listDocs(a)).documents).toHaveLength(0);
  });
});

describe("over loopback HTTP: a session keeps the role it was opened with", () => {
  it("the shared token cannot reuse a GUI session id (403); the GUI token can", async () => {
    const host = await createCollabHost({ port: 0, hostJsonPath: null });
    try {
      const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
      const accept = "application/json, text/event-stream";
      const r = await fetch(host.url, { method: "POST", headers: { Authorization: `Bearer ${host.guiToken}`, "content-type": "application/json", accept }, body: JSON.stringify(init) });
      expect(r.status).toBe(200);
      const sid = r.headers.get("mcp-session-id");
      expect(sid).toBeTruthy();
      await r.body?.cancel();
      const ping = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" });
      const asAi = await fetch(host.url, { method: "POST", headers: { Authorization: `Bearer ${host.token}`, "mcp-session-id": sid!, "content-type": "application/json", accept }, body: ping });
      expect(asAi.status).toBe(403);
      expect(await asAi.text()).toBe("session role mismatch");
      const asGui = await fetch(host.url, { method: "POST", headers: { Authorization: `Bearer ${host.guiToken}`, "mcp-session-id": sid!, "content-type": "application/json", accept }, body: ping });
      expect(asGui.status).toBe(200);
      await asGui.body?.cancel();
    } finally {
      await host.close();
    }
  });
});
