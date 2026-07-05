/**
 * collab-client.ts — the webview's MCP CLIENT half of P2 collaboration. The GUI connects to the
 * local collab host (host.ts) as an equal MCP client: it drives the engine via tool calls (human
 * edits round-trip here in P2.5) and SUBSCRIBES to the host's deckChanged / documentOpened /
 * documentClosed notifications so the live deck projection updates as the AI works. React rendering
 * lives elsewhere (P2.4 UI); this module is the transport + event plumbing, testable headless
 * against createCollabHost.
 *
 * `fetch` is injected: the Tauri webview passes the Rust plugin-http fetch (no browser Origin, no
 * CORS, reaches loopback) — the same reason the bearer token, not Origin, is the trust boundary.
 * Tests pass Node's global fetch.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const NOTIFY = "notifications/slidecraft/";

export interface DeckChangedEvent { docId: string; rev: number; opId?: string; }
export interface DocumentOpenedEvent { docId: string; title: string; slideCount: number; }
export interface DocumentClosedEvent { docId: string; }

export interface CollabEvents {
  onDeckChanged?(e: DeckChangedEvent): void;
  onDocumentOpened?(e: DocumentOpenedEvent): void;
  onDocumentClosed?(e: DocumentClosedEvent): void;
}

export interface CollabClientOptions {
  url: string;
  token: string;
  /** "gui" (the human's webview — sees all docs) or "ai". Default "gui". */
  role?: "gui" | "ai";
  /** inject the Tauri plugin-http fetch in the webview; omit in tests (uses global fetch). */
  fetch?: typeof fetch;
  events?: CollabEvents;
}

/** A thin, typed wrapper over the MCP client for the collab host. */
export class CollabClient {
  private readonly opts: CollabClientOptions;
  private readonly client: Client;
  private readonly transport: StreamableHTTPClientTransport;

  constructor(opts: CollabClientOptions) {
    this.opts = opts;
    this.transport = new StreamableHTTPClientTransport(new URL(opts.url), {
      requestInit: { headers: { Authorization: `Bearer ${opts.token}`, "x-slidecraft-role": opts.role ?? "gui" } },
      fetch: opts.fetch,
    });
    this.client = new Client({ name: "slidecraft-gui", version: "0.1.0" });
    this.client.fallbackNotificationHandler = async (n) => this.dispatch(n.method, (n.params ?? {}) as Record<string, unknown>);
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  /** Call a host tool and return its parsed result JSON. An UNMODELED crash (isError:true) throws; a
   *  MODELED failure — a guard rejection (out-of-range/未オープン → { ok:false, code }) or a domain
   *  reject ({ ok:false }) — is returned for the caller to branch on (error-contract unification). */
  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = (await this.client.callTool({ name, arguments: args })) as { content: { text?: string }[]; isError?: boolean };
    const text = res.content[0]?.text ?? "null";
    if (res.isError) throw new Error(text);
    return JSON.parse(text) as T;
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private dispatch(method: string, params: Record<string, unknown>): void {
    const ev = this.opts.events;
    if (!ev) return;
    if (method === `${NOTIFY}deckChanged`) ev.onDeckChanged?.(params as unknown as DeckChangedEvent);
    else if (method === `${NOTIFY}documentOpened`) ev.onDocumentOpened?.(params as unknown as DocumentOpenedEvent);
    else if (method === `${NOTIFY}documentClosed`) ev.onDocumentClosed?.(params as unknown as DocumentClosedEvent);
  }
}
