/**
 * host-core.ts — the multi-document registry + server-side undo for the P2 collaboration host.
 * PURE Node (no transport, no DOM): the sidecar (host.ts, P2.2) wires this to MCP, but the
 * logic here is independently unit-testable. The headless stdio baseline (cli.ts) never touches
 * this — it keeps its single Session.
 *
 * Model: ONE DocEntry per OPEN document, keyed by an EPHEMERAL docId (crypto.randomUUID — the
 * same scheme the GUI uses for tab ids; durable identity stays the .scft FILE). Each entry
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

/** The per-connection + registry surface the MCP server needs in HOST (collab) mode. The host
 *  process (host.ts, P2.2) owns connection state (keyed on the MCP transport sessionId) and the
 *  server→client notifications; buildServer just consumes this. Absent in stdio mode, where the
 *  server keeps its single Session. */
export interface HostContext {
  registry: DocRegistry;
  /** The active docId for the connection making the current call (host keys on extra.sessionId). */
  active(extra: unknown): string | undefined;
  setActive(extra: unknown, docId: string): void;
  /** AI clients see only shared docs (private-by-default); the GUI sees all. */
  sharedOnly: boolean;
  /** The template registry the AI can pick from (list_templates / use_template, S2 増分2). The
   *  registry actually LIVES in the webview (useMasterRegistry / master-store, Tauri fs); the sidecar
   *  is Node with no fs plugin, so the GUI PUSHES it over the protocol (register_templates) into this
   *  shared store — the same way it seeds the deck. Absent until a GUI has registered (or in a host
   *  that never wires it) → list/use degrade never-silently to a create_template hint. */
  templates?: TemplateStore;
  /** A deck-changing op committed on `entry` (its docId/rev are current) — the host fans out
   *  deckChanged to every connected client (incl. undo/redo, which mint a new rev). `opId` (when the
   *  caller supplied one) rides along on the notification so the ORIGINATOR can suppress its own echo
   *  (P2.5 round-trip); undo/redo and AI edits pass none → everyone re-pulls. */
  onMutated?(entry: DocEntry, tool: string, opId?: string): void;
  notifyOpened?(entry: DocEntry): void;
  notifyClosed?(docId: string): void;
}

/** Metadata for one registered template, mirrored from the GUI's MasterEntry (bytes kept host-side,
 *  never handed to the AI — it references a template by id, not by carrying its base64). */
export interface TemplateInfo {
  id: string;
  name: string;
  builtin: boolean;
}

/** The host-side view of the GUI's master registry (S2 増分2). Populated by register_templates (a
 *  gui-role tool) and read by list_templates / use_template. */
export interface TemplateStore {
  /** Metadata only — the AI chooses by id/name, it never receives the bytes. */
  list(): TemplateInfo[];
  /** The registered template's .pptx bytes, or undefined for an unknown id (never a fake-empty). */
  getBytes(id: string): Uint8Array | undefined;
  /** REPLACE the whole set with the caller's registry — the GUI's list is the single truth, so a
   *  removed master drops out and re-registers stay idempotent. */
  register(items: { id: string; name: string; builtin: boolean; bytes: Uint8Array }[]): void;
}

/** In-memory TemplateStore owned by the collab host (host.ts) and shared across its connections.
 *  PURE Node — no transport/fs — so it is unit-testable and keeps the sidecar fs-plugin-free. */
export class MemTemplateStore implements TemplateStore {
  private items = new Map<string, { info: TemplateInfo; bytes: Uint8Array }>();

  register(items: { id: string; name: string; builtin: boolean; bytes: Uint8Array }[]): void {
    this.items.clear();
    for (const it of items) this.items.set(it.id, { info: { id: it.id, name: it.name, builtin: it.builtin }, bytes: it.bytes });
  }

  list(): TemplateInfo[] {
    return [...this.items.values()].map((v) => v.info);
  }

  getBytes(id: string): Uint8Array | undefined {
    return this.items.get(id)?.bytes;
  }
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
 *  push the new deck onto the undo history and bump rev. A handler that reports it changed nothing —
 *  a never-silent reject ({ok:false}) OR a real no-op ({changed:false}, e.g. an identical
 *  set_slide_diagram write or a design intent whose ops all no-op'd) — must NOT push history / bump
 *  rev / fan out deckChanged (Theme 3 S3: kills the spurious collab echo + undo-history pollution that
 *  gating on {ok:false} alone let through). NOT used for new/open_project, which mint their own history. */
export async function commitMutation(entry: DocEntry, mutate: (s: Session) => unknown | Promise<unknown>): Promise<CommitResult> {
  const result = await mutate(entry.session);
  const r = result as { ok?: unknown; changed?: unknown };
  if (result && typeof result === "object" && (r.ok === false || r.changed === false)) {
    // A no-op handler ({changed:false}) may still have reassigned session.deck to a CONTENT-EQUAL new
    // object; re-sync it to history.present so the invariant (history.present === session.deck) holds
    // without a commit. Safe: every mutation's `changed` is content-based (afterMd/serialize/split), so
    // changed:false ⟺ content-unchanged — this discards a redundant object, never a real edit. A
    // {ok:false} reject never reassigned session.deck, so this is idempotent there.
    entry.session.deck = entry.history.present;
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
