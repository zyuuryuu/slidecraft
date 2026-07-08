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
import { CollabClient, type DeckChangedEvent } from "./collab-client";
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

/** Result of a P2.5 human edit round-trip. `stale` = the doc moved on under us (someone edited first);
 *  the projection has already re-pulled the host truth. */
export interface SendResult {
  ok: boolean;
  rev?: number;
  stale?: boolean;
  message?: string;
}

/** Result of a rerouted GUI Undo/Redo (host server-side history). */
export interface UndoResult {
  ok: boolean;
  rev?: number;
  canUndo?: boolean;
  canRedo?: boolean;
  reason?: string;
}

export class CollabProjection {
  private readonly client: CollabClient;
  private readonly opts: CollabProjectionOptions;
  private targetDocId: string | null = null;
  private lastDocId: string | null = null;
  private lastRev = -1;
  // Explicit pause: the GUI's active tab mirrors NO host doc (a local-only tab). Distinct from the
  // initial targetDocId=null (which auto-picks a doc) — while paused, tick() applies nothing so the
  // local tab is never clobbered by a host deck.
  private mirrorPaused = false;
  private poll: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private pending = false;
  private closed = false;
  // P2.5 round-trip: while an edit is being sent, pause pulls (don't re-clobber the optimistic local
  // edit before the send's rev lands). recentSelfOpIds lets us drop the echo of our own edits.
  private sending = false;
  private readonly recentSelfOpIds = new Set<string>();
  private opSeq = 0;

  constructor(opts: CollabProjectionOptions) {
    this.opts = opts;
    this.client = new CollabClient({
      url: opts.url,
      token: opts.token,
      role: "gui", // the human's webview sees ALL docs (private-by-default applies to AI clients)
      fetch: opts.fetch,
      events: {
        onDeckChanged: (e) => this.onRemoteDeckChanged(e),
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
    if (docId === null) {
      this.mirrorPaused = true; // a local/no-host tab is active → stop mirroring (don't clobber it)
      return;
    }
    this.mirrorPaused = false;
    this.targetDocId = docId;
    this.scheduleTick();
  }

  /** P2.5 round-trip: push a per-slide human edit to the host (the single truth). The caller has
   *  already applied it locally (optimistic); we send with `expectedRev` so a stale edit (someone
   *  edited first) is rejected never-silently → we re-pull and report `stale`. The echo of our own
   *  `opId` is suppressed (onRemoteDeckChanged) so we never re-apply our own edit on top of itself. */
  async sendSlideMarkdown(index: number, markdown: string): Promise<SendResult> {
    const docId = this.targetDocId;
    if (!docId) return { ok: false, message: "ドキュメントが選択されていません" };
    const opId = this.mintOpId();
    this.recentSelfOpIds.add(opId);
    if (this.recentSelfOpIds.size > 64) this.recentSelfOpIds.delete(this.recentSelfOpIds.values().next().value as string);
    this.sending = true;
    let reconcile = false; // re-pull AFTER `sending` clears (a scheduleTick now would bail in tick())
    try {
      const res = await this.client.callTool<{ ok?: boolean; stale?: boolean; error?: string; rev?: number }>("set_slide_markdown", {
        index,
        markdown,
        docId,
        expectedRev: this.lastRev,
        opId,
      });
      if (res.ok === false) {
        this.recentSelfOpIds.delete(opId);
        reconcile = true; // reconcile local view with host truth
        return { ok: false, stale: !!res.stale, message: res.error ?? (res.stale ? "他のクライアントが先に編集しました（再取得しました）" : "編集を適用できませんでした") };
      }
      if (typeof res.rev === "number") {
        this.lastRev = res.rev; // advance so neither the echo nor the poll re-pulls our own edit
        this.lastDocId = docId;
      }
      return { ok: true, rev: res.rev };
    } catch (e) {
      this.recentSelfOpIds.delete(opId);
      reconcile = true;
      return { ok: false, message: msg(e) };
    } finally {
      this.sending = false;
      if (reconcile) this.scheduleTick(); // now `sending` is false → tick() will actually pull
    }
  }

  /** P2.5: reroute the GUI Undo/Redo to the HOST's server-side history (single truth). The rolled-back
   *  deck arrives via the normal pull (its deckChanged carries no opId → not suppressed). Returns the
   *  host's canUndo/canRedo in the result; for now the GUI keeps Undo/Redo enabled while connected and
   *  toasts on an empty history (wiring the buttons to these values is a P2.5b refinement). */
  async serverUndo(): Promise<UndoResult> {
    return this.serverHistory("undo");
  }
  async serverRedo(): Promise<UndoResult> {
    return this.serverHistory("redo");
  }
  private async serverHistory(tool: "undo" | "redo"): Promise<UndoResult> {
    const docId = this.targetDocId;
    if (!docId) return { ok: false, reason: "no-document" };
    try {
      const r = await this.client.callTool<UndoResult>(tool, { docId });
      if (r.ok) this.scheduleTick(); // pull the rolled-back deck promptly (the push will also arrive)
      return r;
    } catch (e) {
      return { ok: false, reason: msg(e) };
    }
  }

  private mintOpId(): string {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    return c?.randomUUID ? c.randomUUID() : `op-${++this.opSeq}`;
  }

  /** A deckChanged arrived. If it's the echo of OUR OWN edit (an opId we sent), suppress the re-pull
   *  — we already applied it optimistically — but advance lastRev so the poll doesn't re-pull it.
   *  Anyone else's change (AI edit, undo/redo, foreign/absent opId) → reconcile by pulling. */
  private onRemoteDeckChanged(e: DeckChangedEvent): void {
    if (e.opId && this.recentSelfOpIds.has(e.opId)) {
      this.recentSelfOpIds.delete(e.opId);
      if (e.docId === this.targetDocId && e.rev > this.lastRev) this.lastRev = e.rev;
      return;
    }
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
    if (this.closed || this.sending || this.mirrorPaused) return; // paused = active tab is local (no host doc)
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
    // The get_deck await is a window in which the GUI may have switched to a LOCAL tab (mirrorPaused),
    // re-targeted another doc, or stopped. A pull that started before that must NOT land now and clobber
    // the local/other tab — re-check here and drop it WITHOUT advancing lastRev (so a resume re-applies).
    if (this.closed || this.mirrorPaused || (this.targetDocId !== null && this.targetDocId !== target.docId)) return;
    this.lastDocId = target.docId;
    this.lastRev = target.rev;
    this.opts.onDeck({ deck, rev: target.rev, docId: target.docId, title: target.title, isInitial });
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
