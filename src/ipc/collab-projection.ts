/**
 * collab-projection.ts — the P2.4 LIVE PROJECTION. Keeps a webview deck view in lock-step with the
 * collab host's truth: owns a gui-role CollabClient and, whenever the host signals a change
 * (deckChanged / documentOpened push, OR a poll tick), PULLs the target doc via get_deck and hands
 * the fresh DeckIR to onDeck so React can `setDeck(next, 'commit')` — the undoable projection the
 * design specifies.
 *
 * Why both push AND poll: the SSE notification stream over the Tauri plugin-http fetch is the
 * design's biggest unproven risk. The poll is the RELIABLE floor (plain POSTs always work); push is
 * the low-latency bonus. Both funnel through ONE rev-guarded, serialized pump so a doc is applied
 * exactly once per rev no matter how many signals race in.
 *
 * Pure (no React / no Tauri): the hook injects the Tauri plugin-http fetch; tests drive it against a
 * real createCollabHost over Node's global fetch.
 */
import { CollabClient } from "./collab-client";
import type { DeckIR } from "../engine/slide-schema";

export type CollabStatus = "idle" | "connecting" | "connected" | "error";

export interface DocSummary {
  docId: string;
  title: string;
  slideCount: number;
  dirty: boolean;
  rev: number;
  shared: boolean;
}

export interface ProjectedDeck {
  deck: DeckIR | null;
  rev: number;
  docId: string;
  title: string;
  /** True on the FIRST apply of a doc (adopt). The caller applies it 'silent' (replace the view
   *  without an undo step) so seeding the user's own deck doesn't clobber/pollute undo; subsequent
   *  revs are 'commit' (one undoable step per AI edit). */
  isInitial: boolean;
}

export interface CollabProjectionOptions {
  url: string;
  token: string;
  /** inject the Tauri plugin-http fetch in the webview; omit in tests (Node global fetch). */
  fetch?: typeof fetch;
  /** poll interval (ms) for the rev fallback; 0 disables it (push-only, used by tests). Default 1200. */
  pollMs?: number;
  /** A freshly-pulled deck for a NEW rev (or a newly-adopted doc) → React setDeck(next,'commit'). */
  onDeck(p: ProjectedDeck): void;
  onStatus?(s: CollabStatus, detail?: string): void;
  onDocs?(docs: DocSummary[]): void;
}

export class CollabProjection {
  private readonly client: CollabClient;
  private readonly opts: CollabProjectionOptions;
  private targetDocId: string | null = null;
  private lastDocId: string | null = null;
  private lastRev = -1;
  private poll: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private pending = false;
  private closed = false;

  constructor(opts: CollabProjectionOptions) {
    this.opts = opts;
    this.client = new CollabClient({
      url: opts.url,
      token: opts.token,
      role: "gui", // the human's webview sees ALL docs (private-by-default applies to AI clients)
      fetch: opts.fetch,
      events: {
        onDeckChanged: () => this.scheduleTick(),
        onDocumentOpened: () => this.scheduleTick(),
        onDocumentClosed: () => this.scheduleTick(),
      },
    });
  }

  async start(): Promise<void> {
    this.opts.onStatus?.("connecting");
    try {
      await this.client.connect();
    } catch (e) {
      this.opts.onStatus?.("error", msg(e));
      throw e;
    }
    this.opts.onStatus?.("connected");
    await this.pump(); // initial reconcile: adopt + mirror any doc already open
    if (this.closed) return; // the initial reconcile hit a hard error (failAndStop) → don't start polling
    const ms = this.opts.pollMs ?? 1200;
    if (ms > 0) this.poll = setInterval(() => this.scheduleTick(), ms);
  }

  /** Passthrough so the hook can seed (new_project) / inspect through the same connection. */
  callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.client.callTool<T>(name, args);
  }

  /** Pin which doc to mirror; null = auto-adopt the first available. Triggers a reconcile. */
  setTargetDoc(docId: string | null): void {
    this.targetDocId = docId;
    this.scheduleTick();
  }

  async stop(): Promise<void> {
    this.closed = true;
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
    try {
      await this.client.close();
    } catch {
      /* ignore */
    }
  }

  /** A tick hit a hard error (host gone, session dropped, sleep/wake). Stop polling + drop the
   *  connection so it can't hammer a dead loopback forever, and surface the error. The hook nulls
   *  its ref on 'error' so the next 開始 re-establishes a fresh session (never-silent recovery). */
  private failAndStop(detail: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
    void this.client.close().catch(() => {});
    this.opts.onStatus?.("error", detail);
  }

  private scheduleTick(): void {
    if (this.closed) return;
    void this.pump();
  }

  /** Serialize ticks; coalesce a burst of signals into a single trailing run (no overlap, no drop). */
  private async pump(): Promise<void> {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.pending = false;
        await this.tick();
      } while (this.pending && !this.closed);
    } finally {
      this.running = false;
    }
  }

  private async tick(): Promise<void> {
    if (this.closed) return;
    let listed: { documents: DocSummary[]; activeDocId: string | null };
    try {
      listed = await this.client.callTool<{ documents: DocSummary[]; activeDocId: string | null }>("list_documents");
    } catch (e) {
      this.failAndStop(msg(e));
      return;
    }
    const docs = listed.documents ?? [];
    this.opts.onDocs?.(docs);

    const pick = (id: string | null): DocSummary | undefined => (id ? docs.find((d) => d.docId === id) : undefined);
    const target = pick(this.targetDocId) ?? pick(this.lastDocId) ?? docs[0];
    if (!target) {
      // No doc open yet — waiting for the AI (or a seed) to mint one. Reset so the next doc applies.
      this.lastDocId = null;
      this.lastRev = -1;
      return;
    }
    this.targetDocId = target.docId;
    if (this.lastDocId === target.docId && target.rev <= this.lastRev) return; // already at this rev

    const isInitial = this.lastDocId !== target.docId; // first apply of this doc → caller uses 'silent'
    let deck: DeckIR | null;
    try {
      deck = await this.client.callTool<DeckIR | null>("get_deck", { docId: target.docId });
    } catch (e) {
      this.failAndStop(msg(e));
      return;
    }
    this.lastDocId = target.docId;
    this.lastRev = target.rev;
    this.opts.onDeck({ deck, rev: target.rev, docId: target.docId, title: target.title, isInitial });
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
