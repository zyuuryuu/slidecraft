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
 *
 * #730: the ROLE is decided by the host from WHICH token is presented — the GUI-only token (handed to the
 * webview by Rust from the READY line) makes this a GUI connection; the shared host.json token an AI one.
 * There is no role header any more (a self-declared role is refused without the GUI token).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const NOTIFY = "notifications/slidecraft/";

/** `origin` / `changedIndices` are ADDITIVE (#407): who caused it (host's view of the connection role)
 *  and which slides changed (0-based, post-change deck; absent = granularity unknown). */
/** `templateChanged`/`templateName` (#616, ADDITIVE): the doc's TEMPLATE was replaced at this rev (deck unchanged). */
export interface DeckChangedEvent { docId: string; rev: number; opId?: string; origin?: "ai" | "gui"; changedIndices?: number[]; templateChanged?: boolean; templateName?: string; }
export interface DocumentOpenedEvent { docId: string; title: string; slideCount: number; }
export interface DocumentClosedEvent { docId: string; }

export interface CollabEvents {
  onDeckChanged?(e: DeckChangedEvent): void;
  onDocumentOpened?(e: DocumentOpenedEvent): void;
  onDocumentClosed?(e: DocumentClosedEvent): void;
  /** #727 (GUI connections only): the approval state changed (an AI applied / was decided / revoked). */
  onClientApprovalsChanged?(e: { pending: number }): void;
  /** #727 (GUI connections only): an allowed AI made its first tool call — seed the deck, lock edits. */
  onAiActive?(e: { seedRequested: boolean }): void;
}

export interface CollabClientOptions {
  url: string;
  /** the bearer to present: the GUI-only token (→ GUI: sees all docs) or the shared token (→ AI). */
  token: string;
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
      requestInit: { headers: { Authorization: `Bearer ${opts.token}` } },
      fetch: opts.fetch,
    });
    this.client = new Client({ name: "slidecraft-gui", version: "0.5.0" });
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
    else if (method === `${NOTIFY}clientApprovalsChanged`) ev.onClientApprovalsChanged?.(params as { pending: number });
    else if (method === `${NOTIFY}aiActive`) ev.onAiActive?.(params as { seedRequested: boolean });
  }
}
