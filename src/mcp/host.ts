/**
 * host.ts — the P2 collaboration LISTENER. The GUI launches this; the upstream AI AND the webview
 * connect IN as equal MCP clients (Streamable HTTP over loopback). ONE shared DocRegistry is the
 * truth; each connection is its own {McpServer, transport} pair (the SDK binds one server per
 * transport), and a deck mutation FANS OUT deckChanged to every connected client. The bearer token
 * is the trust boundary (host-security); the URL+token are published in host.json for discovery. The
 * GUI holds a SEPARATE per-launch GUI token (#730) that only travels on the READY line — that token,
 * not a self-declared header, is what makes a connection the GUI.
 *
 * Node-only (http, crypto). NOT used by the stdio baseline (cli.ts), which stays listener-less.
 */
import { createServer, type IncomingMessage, type Server } from "http";
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
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
  /** bind address; default 127.0.0.1 (never 0.0.0.0). */
  host?: string;
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
  const bindHost = opts.host ?? "127.0.0.1";
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

  // A HostContext per connection: shared registry/conns/broadcast, but sharedOnly reflects THIS
  // connection's role (AI = shared docs only; GUI = all). The role comes from WHICH bearer the
  // connection presented (admitRequest: GUI token → gui, shared token → ai) — never from a header (#730).
  const makeHostCtx = (aiClient: boolean): HostContext => ({
    registry,
    active: (extra) => { const s = sidOf(extra); return s ? activeByConn.get(s) : undefined; },
    setActive: (extra, docId) => { const s = sidOf(extra); if (s) activeByConn.set(s, docId); },
    sharedOnly: aiClient,
    guiClient: !aiClient,
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
      const existing = req.headers["mcp-session-id"] as string | undefined;
      const conn = existing ? conns.get(existing) : undefined;
      // A session opened by the GUI stays the GUI's: the shared token cannot ride its session id (#730).
      if (conn && conn.role !== role) { res.writeHead(403, { "content-type": "text/plain" }).end("session role mismatch"); return; }

      if (req.method === "POST") {
        const body = await readBody(req);
        let transport = conn?.transport;
        if (!transport) {
          if (!isInitializeRequest(body)) { res.writeHead(400, { "content-type": "text/plain" }).end("no session"); return; }
          const server = buildServer(createSession(null), { host: makeHostCtx(aiClient), registerResources: false, metrics });
          const t = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => { conns.set(id, { server, transport: t, role }); },
          });
          t.onclose = () => { const id = t.sessionId; if (id) { conns.delete(id); activeByConn.delete(id); } };
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
