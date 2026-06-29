/**
 * host-core.ts — the multi-document registry + server-side undo for the P2 collaboration host.
 * PURE Node (no transport, no DOM): the sidecar (host.ts, P2.2) wires this to MCP, but the
 * logic here is independently unit-testable. The headless stdio baseline (cli.ts) never touches
 * this — it keeps its single Session.
 *
 * Model: ONE DocEntry per OPEN document, keyed by an EPHEMERAL docId (crypto.randomUUID — the
 * same scheme the GUI uses for tab ids; durable identity stays the .slidecraft FILE). Each entry
 * carries its own deck Session, a forward-only `rev`, and a full undo HISTORY (shared
 * history-core reducer). Because BOTH AI tool calls and (relayed) human GUI edits commit through
 * `commitMutation`, there is ONE unified undo timeline per doc.
 */
import { randomUUID } from "crypto";
import type { Session } from "./session";
import type { DeckIR } from "../engine/slide-schema";
import { historyReducer, type HState } from "../shared/history-core";

export interface DocEntry {
  docId: string;
  session: Session;
  /** Monotonic, forward-only. Bumped on every committed mutation AND on undo/redo (which mint a
   *  NEW higher rev whose deck equals a past deck), so rev never goes backwards. */
  rev: number;
  /** Undo history; INVARIANT: history.present === session.deck after every host op. */
  history: HState<DeckIR | null>;
  title: string;
  /** Private-by-default: a doc the human opened is NOT visible to the AI until shared. */
  shared: boolean;
}

function seedHistory(deck: DeckIR | null): HState<DeckIR | null> {
  return { past: [], present: deck, future: [], lastTs: 0 };
}

/** A live map of docId → DocEntry. Holds NO transport/connection state (that lives in host.ts). */
export class DocRegistry {
  private docs = new Map<string, DocEntry>();

  /** Mint a new entry around an already-loaded Session (its deck seeds the history). */
  create(session: Session, title: string, shared: boolean): DocEntry {
    const entry: DocEntry = { docId: randomUUID(), session, rev: 0, history: seedHistory(session.deck), title, shared };
    this.docs.set(entry.docId, entry);
    return entry;
  }

  has(docId: string): boolean {
    return this.docs.has(docId);
  }

  /** Never-silent: a closed/unknown doc throws rather than returning a fake-empty deck. */
  get(docId: string): DocEntry {
    const e = this.docs.get(docId);
    if (!e) throw new Error(`ドキュメントが見つかりません（閉じられた可能性）: ${docId}`);
    return e;
  }

  remove(docId: string): void {
    if (!this.docs.delete(docId)) throw new Error(`ドキュメントが見つかりません: ${docId}`);
  }

  get size(): number {
    return this.docs.size;
  }

  /** The sole doc's id when exactly one is open, else null — the fallback that lets a
   *  connection with no explicit/active doc (stdio, in-memory tests) still resolve. */
  soleDocId(): string | null {
    return this.docs.size === 1 ? this.docs.keys().next().value ?? null : null;
  }

  list(opts: { sharedOnly?: boolean } = {}): { docId: string; title: string; slideCount: number; dirty: boolean; rev: number; shared: boolean }[] {
    const out: { docId: string; title: string; slideCount: number; dirty: boolean; rev: number; shared: boolean }[] = [];
    for (const e of this.docs.values()) {
      if (opts.sharedOnly && !e.shared) continue;
      out.push({ docId: e.docId, title: e.title, slideCount: e.session.deck?.slides.length ?? 0, dirty: e.session.dirty, rev: e.rev, shared: e.shared });
    }
    return out;
  }
}

export interface CommitResult {
  result: unknown;
  /** Whether the deck actually changed (false = the handler rejected with {ok:false}). */
  changed: boolean;
  rev: number;
}

/** Run a deck-MUTATING handler against an entry, then (only if it actually changed the deck)
 *  push the new deck onto the undo history and bump rev. A handler returning {ok:false} is a
 *  never-silent reject that changed nothing → no history push, no rev bump. NOT used for
 *  new/open_project, which mint a fresh DocEntry with its own seeded history. */
export async function commitMutation(entry: DocEntry, mutate: (s: Session) => unknown | Promise<unknown>): Promise<CommitResult> {
  const result = await mutate(entry.session);
  if (result && typeof result === "object" && (result as { ok?: unknown }).ok === false) {
    return { result, changed: false, rev: entry.rev };
  }
  // history.present was the OLD deck (in sync pre-mutation); the handler swapped session.deck to
  // the NEW deck → push OLD onto past, present := NEW. Keeps history.present === session.deck.
  entry.history = historyReducer(entry.history, { type: "set", next: entry.session.deck, mode: "commit", ts: 0, coalesceMs: 0 });
  entry.rev += 1;
  return { result, changed: true, rev: entry.rev };
}

export interface UndoResult {
  ok: boolean;
  rev: number;
  canUndo: boolean;
  canRedo: boolean;
  reason?: string;
}

/** Roll the doc's truth back one step: undo MINTS a new forward rev whose deck equals the prior
 *  deck (rev stays monotonic). Re-syncs session.deck to history.present. */
export function undoDoc(entry: DocEntry): UndoResult {
  if (entry.history.past.length === 0) {
    return { ok: false, rev: entry.rev, canUndo: false, canRedo: entry.history.future.length > 0, reason: "nothing-to-undo" };
  }
  entry.history = historyReducer(entry.history, { type: "undo" });
  entry.session.deck = entry.history.present;
  entry.session.dirty = true;
  entry.rev += 1;
  return { ok: true, rev: entry.rev, canUndo: entry.history.past.length > 0, canRedo: entry.history.future.length > 0 };
}

/** Symmetric to undoDoc. */
export function redoDoc(entry: DocEntry): UndoResult {
  if (entry.history.future.length === 0) {
    return { ok: false, rev: entry.rev, canUndo: entry.history.past.length > 0, canRedo: false, reason: "nothing-to-redo" };
  }
  entry.history = historyReducer(entry.history, { type: "redo" });
  entry.session.deck = entry.history.present;
  entry.session.dirty = true;
  entry.rev += 1;
  return { ok: true, rev: entry.rev, canUndo: entry.history.past.length > 0, canRedo: entry.history.future.length > 0 };
}
