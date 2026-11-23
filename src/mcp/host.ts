/**
 * host.ts — the P2 collaboration LISTENER. The GUI launches this; the upstream AI AND the webview
 * connect IN as equal MCP clients (Streamable HTTP over loopback). ONE shared DocRegistry is the
 * truth; each connection is its own {McpServer, transport} pair (the SDK binds one server per
 * transport), and a deck mutation FANS OUT deckChanged to every connected client. The bearer token
 * is the trust boundary (host-security); the URL+token are published in host.json for discovery. The
 * GUI holds a SEPARATE per-launch GUI token (#730) that only travels on the READY line — that token,
 * not a self-declared header, is what makes a connection the GUI.
 * #727 (ADR-0040 D1/D3): the host is ALWAYS ON while the GUI runs, so the shared token only lets an AI client
 * APPLY (at `initialize`, keyed by clientInfo + client id); its tool calls pass the ONE call gate (admitCall →
 * tool-profiles) only after the human allowed it in the GUI (host-approval.ts), and an allowed AI's first call
 * waits for the GUI's deck seed (host-seed.ts). Loopback only (host-options.ts).
 *
 * Node-only (http, crypto). NOT used by the stdio baseline (cli.ts), which stays listener-less.
 */
import { createServer, type IncomingMessage, type Server } from "http";
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { ApprovalBook, type ApplyVia, type ApprovalPort, type ClientInfo, type ConnStatus } from "./host-approval";
import { SeedGate } from "./host-seed";
import { resolveBindHost } from "./host-options";
import { GuardError } from "./guard-errors";
import { createSession } from "./session";
import { buildServer } from "./server";
import { DocRegistry, MemTemplateStore, deckChangedPayload, type HostContext } from "./host-core";
import { mintToken, admitRequest, TAURI_WEBVIEW_ORIGINS, DEV_BROWSER_ORIGINS, type SecurityConfig, type ClientRole } from "./host-security";
import { writeHostJson, clearHostJson, type HostHandshake } from "./host-json";
import { createFileMetricsRecorder } from "./metrics-sink";

const NOTIFY = "notifications/slidecraft/";

export interface CollabHostOptions {
  /** loopback port; 0 = ephemeral (the Tauri host passes 0 → no port conflicts / no stale-sidecar
   *  clashes). Default 5174 is the legacy/standalone default. (The webview reaches the host via Rust
   *  plugin-http, so the CSP does not gate this port — the bearer token is the boundary.) */
  port?: number;
  /** bind address: 127.0.0.1 only — anything else is refused (#727, host-options.resolveBindHost). */
  host?: string;
  /** #727: AI tool calls need the human's [許可] (default true — the production sidecar never turns it off).
   *  false = token-only admission as before ADR-0040, for tests about OTHER host features. */
  requireClientApproval?: boolean;
  /** #727: how long a pending AI call waits for the human before `authorization-pending` (default 30 s). */
  approvalWaitMs?: number;
  /** #727: how long an allowed AI call waits for the GUI's deck seed before `host-not-ready` (default 10 s). */
  seedWaitMs?: number;
  /** where to publish the handshake; null = don't write (tests). */
  hostJsonPath?: string | null;
  /** #512: local JSONL call log for every connection (collab-gui and collab-ai); null/absent = OFF. */
  metricsPath?: string | null;
}

export interface CollabHost {
  url: string;
  port: number;
  token: string;
  /** #730: the GUI-only bearer. Goes on the READY line ONLY — never host.json / logs / argv. */
  guiToken: string;
  registry: DocRegistry;
  close(): Promise<void>;
}

interface Conn {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  /** the role the session was opened with; every later request on it must present the same bearer kind (#730) */
  role: ClientRole;
}

export async function createCollabHost(opts: CollabHostOptions = {}): Promise<CollabHost> {
  const bindHost = resolveBindHost(opts.host);
  const requireApproval = opts.requireClientApproval ?? true;
  const approvalWaitMs = opts.approvalWaitMs ?? 30_000;
  const seedWaitMs = opts.seedWaitMs ?? 10_000;
  const token = mintToken();
  const guiToken = mintToken(); // #730: independent of `token`; never written to host.json
  const sec: SecurityConfig = {
    token,
    guiToken,
    // ONE source of truth (host-security) shared with the origin-policy test — never hand-patch
    // per-OS origins here again. The token is the boundary; this list is the browser-rebinding belt.
    allowedOrigins: new Set([...TAURI_WEBVIEW_ORIGINS, ...DEV_BROWSER_ORIGINS]),
    allowedHosts: new Set(["127.0.0.1", "localhost"]),
  };

  const registry = new DocRegistry();
  // ONE recorder shared by all connections (one append stream; each line carries its profile).
  const metrics = opts.metricsPath ? createFileMetricsRecorder(opts.metricsPath) : undefined;
  // ONE template store shared across connections: the gui-role client uploads the master registry
  // (register_templates), AI-role clients read it (list_templates / use_template). S2 増分2.
  const templates = new MemTemplateStore();
  const conns = new Map<string, Conn>(); // mcpSessionId → connection
  const activeByConn = new Map<string, string>(); // mcpSessionId → active docId

  const broadcast = (method: string, params: Record<string, unknown>): void => {
    for (const c of conns.values()) void c.server.server.notification({ method: `${NOTIFY}${method}`, params }).catch(() => {});
  };
  const sidOf = (extra: unknown): string | undefined => (extra as { sessionId?: string } | undefined)?.sessionId;
  // #727: approval + seed state live here (one per launch) and are told ONLY to GUI connections.
  const broadcastGui = (method: string, params: Record<string, unknown>): void => {
    for (const c of conns.values()) if (c.role === "gui") void c.server.server.notification({ method: `${NOTIFY}${method}`, params }).catch(() => {});
  };
  const book = new ApprovalBook({ onChange: () => broadcastGui("clientApprovalsChanged", { pending: book.view().pending.length }) });
  const seed = new SeedGate((seedRequested) => broadcastGui("aiActive", { seedRequested }));
  const approvals: ApprovalPort = {
    view: () => ({ ...book.view(), aiActive: seed.aiActive }),
    decide: (id, d) => book.decide(id, d),
    loadGrants: (g) => book.loadGrants(g),
    revoke: (k) => book.revoke(k),
    reportSeed: (st, err) => seed.report(st, err),
  };
  // The ONE approval decision for a call (R8): every AI tool call reaches it through tool-profiles' gate.
  const admitCall = async (extra: unknown): Promise<string | undefined> => {
    if (requireApproval) {
      const sid = sidOf(extra);
      let st: ConnStatus | undefined = sid ? book.status(sid) : undefined;
      if (st === "pending" && sid) st = await book.waitSettled(sid, approvalWaitMs);
      if (st !== "approved") throw refusal(st);
    }
    return seed.admit(seedWaitMs);
  };

  // A HostContext per connection: shared registry/conns/broadcast, but sharedOnly reflects THIS
  // connection's role (AI = shared docs only; GUI = all). The role comes from WHICH bearer the
  // connection presented (admitRequest: GUI token → gui, shared token → ai) — never from a header (#730).
  const makeHostCtx = (aiClient: boolean): HostContext => ({
    registry,
    active: (extra) => { const s = sidOf(extra); return s ? activeByConn.get(s) : undefined; },
    setActive: (extra, docId) => { const s = sidOf(extra); if (s) activeByConn.set(s, docId); },
    sharedOnly: aiClient,
    guiClient: !aiClient,
    admitCall: aiClient ? admitCall : undefined,
    approvals: aiClient ? undefined : approvals,
    templates,
    onMutated: (entry, _tool, opId, changedIndices) => broadcast("deckChanged", deckChangedPayload(entry, opId, aiClient ? "ai" : "gui", changedIndices)),
    // #616: deck unchanged, template replaced → the SAME deckChanged with templateChanged:true (案 A: no new notification).
    onTemplateChanged: (entry) => broadcast("deckChanged", deckChangedPayload(entry, undefined, aiClient ? "ai" : "gui", undefined, { templateName: entry.session.meta.templateName })),
    notifyOpened: (entry) => broadcast("documentOpened", { docId: entry.docId, title: entry.title, slideCount: entry.session.deck?.slides.length ?? 0 }),
    notifyClosed: (docId) => broadcast("documentClosed", { docId }),
  });

  const readBody = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : undefined); } catch { resolve(undefined); } });
      req.on("error", () => resolve(undefined));
    });

  const httpServer: Server = createServer(async (req, res) => {
    try {
      const roleHeader = req.headers["x-slidecraft-role"];
      const adm = admitRequest(
        { host: req.headers.host, origin: req.headers.origin as string | undefined, authorization: req.headers.authorization, role: Array.isArray(roleHeader) ? roleHeader.join(",") : roleHeader },
        sec,
      );
      if ("status" in adm) { res.writeHead(adm.status, { "content-type": "text/plain" }).end(adm.message); return; }
      const role = adm.role;
      const aiClient = role === "ai";
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (req.method === "POST" && (path === "/auth/nonce" || path === "/auth/claim")) { await handleAuth(path, req, res); return; }
      const existing = req.headers["mcp-session-id"] as string | undefined;
      const conn = existing ? conns.get(existing) : undefined;
      // A session opened by the GUI stays the GUI's: the shared token cannot ride its session id (#730).
      if (conn && conn.role !== role) { res.writeHead(403, { "content-type": "text/plain" }).end("session role mismatch"); return; }

      if (req.method === "POST") {
        const body = await readBody(req);
        let transport = conn?.transport;
        if (!transport) {
          if (!isInitializeRequest(body)) { res.writeHead(400, { "content-type": "text/plain" }).end("no session"); return; }
          const applyAs = aiClient ? applicationOf(body.params.clientInfo, req) : undefined;
          if (applyAs === null) { res.writeHead(400, { "content-type": "text/plain" }).end("bad client id"); return; }
          const server = buildServer(createSession(null), { host: makeHostCtx(aiClient), registerResources: false, metrics });
          const t = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              conns.set(id, { server, transport: t, role });
              if (applyAs) book.apply(id, applyAs.info, applyAs.via ?? { kind: "session", sessionId: id }); // #727: the AI applies
            },
          });
          t.onclose = () => { const id = t.sessionId; if (id) { conns.delete(id); activeByConn.delete(id); book.forget(id); } };
          await server.connect(t);
          transport = t;
        }
        await transport.handleRequest(req, res, body);
      } else if (req.method === "GET" || req.method === "DELETE") {
        const transport = conn?.transport;
        if (!transport) { res.writeHead(400, { "content-type": "text/plain" }).end("no session"); return; }
        await transport.handleRequest(req, res);
      } else {
        res.writeHead(405, { "content-type": "text/plain" }).end("method not allowed");
      }
    } catch {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" }).end("internal error");
    }
  });

  // #727 (D3-4): the stdio adapter's side channel — a single-use nonce to sign, and the one-time claim that
  // hands the applicant its secret after [許可]. Both sit behind the same admission (shared token) as /mcp.
  async function handleAuth(path: string, req: IncomingMessage, res: import("http").ServerResponse): Promise<void> {
    const json = (status: number, v: unknown): void => { res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(v)); };
    if (path === "/auth/nonce") return json(200, { nonce: book.issueNonce() });
    const b = (await readBody(req)) as { clientId?: unknown; claim?: unknown } | undefined;
    const secret = typeof b?.clientId === "string" && typeof b.claim === "string" ? book.redeemClaim(b.clientId, b.claim) : undefined;
    return secret ? json(200, { secret }) : json(404, { error: "not-granted" });
  }

  await new Promise<void>((resolve) => httpServer.listen(opts.port ?? 5174, bindHost, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const url = `http://${bindHost}:${port}/mcp`;

  if (opts.hostJsonPath) {
    const hs: HostHandshake = { url, token, pid: process.pid, startedAt: new Date().toISOString() };
    writeHostJson(opts.hostJsonPath, hs);
  }

  const close = async (): Promise<void> => {
    for (const c of conns.values()) { try { await c.transport.close(); } catch { /* ignore */ } }
    conns.clear();
    activeByConn.clear();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    if (opts.hostJsonPath) clearHostJson(opts.hostJsonPath);
  };

  return { url, port, token, guiToken, registry, close };
}

const CLIENT_ID = /^[A-Za-z0-9_-]{8,128}$/;
const header = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};
const clip = (v: unknown, fallback: string): string => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : fallback);

/** #727: what an AI's `initialize` applies as. An adapter (stdio, #728) names its client id + one-time claim, or a
 *  nonce + HMAC proof; anything else is HTTP direct (bound to the session id the transport mints — `via`
 *  undefined here). null = a malformed client id (refused 400). clientInfo is display text, clipped. */
function applicationOf(clientInfo: unknown, req: IncomingMessage): { info: ClientInfo; via?: ApplyVia } | null {
  const ci = (clientInfo ?? {}) as { name?: unknown; version?: unknown };
  const info: ClientInfo = { name: clip(ci.name, "不明なクライアント"), version: clip(ci.version, "?") };
  const clientId = header(req, "x-slidecraft-client-id");
  if (clientId === undefined) return { info };
  if (!CLIENT_ID.test(clientId)) return null;
  return { info, via: { kind: "adapter", clientId, claim: header(req, "x-slidecraft-client-claim"), nonce: header(req, "x-slidecraft-client-nonce"), proof: header(req, "x-slidecraft-client-proof") } };
}

/** The never-silent refusal for an AI call that is not (or no longer) allowed. */
function refusal(st: ConnStatus | undefined): GuardError {
  if (st === "denied") return new GuardError("SlideCraft の GUI でこの接続は拒否されました。GUI の deck には触れられません。", "authorization-denied");
  if (st === "revoked") return new GuardError("SlideCraft の GUI でこの接続の許可が取り消されました。つなぎ直すと、もう一度許可を求めます。", "authorization-revoked");
  return new GuardError("SlideCraft の GUI で、この AI クライアントの接続を許可してください（協働 パネルにダイアログが出ています）。許可した後に同じ呼び出しをやり直してください。", "authorization-pending");
}
