/**
 * adaptive-front.ts — #728 (ADR-0040 D2): the stdio adapter (`slidecraft mcp`) as a small state machine that
 * RE-DISCOVERS the GUI's collab host in front of each tool call, instead of once at startup (ADR-0033 D2, now
 * partly superseded). It routes raw JSON-RPC between three wires:
 *  - local: the AI (stdio, behind the #518 discover-probe filter);
 *  - solo:  the in-process solo server (kept alive the whole time — the AI's `initialize` is always its);
 *  - the host (an Attachment from host-attach.ts) while forwarding.
 * The transitions themselves are pure (front-decide.ts). This file only applies them:
 *  - a tool call while solo → decideSoloCall → attach + forward THIS call, or answer solo (maybe with a `note`);
 *  - a forward that fails → decideHostLost → re-attach to a new host, or back to solo (deck-less) + `note`;
 *  - each switch tells the AI `notifications/tools/list_changed` (solo and collab lists differ slightly);
 *  - a forwarded result's code: authorization-denied → solo against that launch; -revoked → drop the secret and
 *    apply again; anything admitted → redeem the one-time claim (once).
 * Holds no deck state while forwarding (ADR-0033: the host is the only control plane then).
 *
 * Known limit: a call already delivered to a host that dies before answering is not answered here (the AI's own
 * request timeout applies); the NEXT call notices and switches. The host-start/stop e2e is #728's follow-up (c).
 */
import { isJSONRPCNotification, isJSONRPCRequest, type JSONRPCMessage, type RequestId } from "@modelcontextprotocol/sdk/types.js";
import { forwardBanner } from "./cli-banner";
import { decideHostLost, decideSoloCall, frontNoteText, hostKey, type FrontNote } from "./front-decide";
import { initParamsOf, type Attachment, type FrontWire, type InitParams } from "./host-attach";
import type { HostHandshake } from "./host-json";
import { withNote, type ToolResult } from "./tool-result";

export type { Attachment, FrontWire } from "./host-attach";

export interface AdaptiveFrontDeps {
  local: FrontWire;
  solo: FrontWire;
  /** the solo doc holding a deck (host-core.openDeckDocId), or null */
  soloDeckDocId(): string | null;
  watch: { live(): Promise<HostHandshake | null>; markDead(h: HostHandshake): void };
  attach(host: HostHandshake, init: InitParams): Promise<Attachment>;
  /** one stderr line (banners, switches) */
  log(line: string): void;
}

const LIST_CHANGED: JSONRPCMessage = { jsonrpc: "2.0", method: "notifications/tools/list_changed" };
const isResponse = (m: JSONRPCMessage): m is JSONRPCMessage & { id: RequestId } => !("method" in m) && "id" in m;

/** The guard code of a tool result ({ok:false, code} envelope — tool-result.ts), if any. */
function codeOf(result: unknown): string | undefined {
  const first = (result as ToolResult | undefined)?.content?.[0];
  if (first?.type !== "text") return undefined;
  try {
    const v = JSON.parse(first.text) as { ok?: unknown; code?: unknown };
    return v.ok === false && typeof v.code === "string" ? v.code : undefined;
  } catch {
    return undefined;
  }
}

export class AdaptiveFront {
  private att: Attachment | undefined;
  private init: InitParams = initParamsOf(undefined);
  private deniedKey: string | undefined;
  /** the next solo tool-call result carries this note (set when forwarding ended because the host was lost) */
  private pendingNote: FrontNote | undefined;
  /** tool calls answered by solo that get a note: request id → note text */
  private readonly soloNotes = new Map<RequestId, string>();
  /** tool calls forwarded to the host: request id → the attachment they went to */
  private readonly forwarded = new Map<RequestId, Attachment>();
  /** requests the host sent to the AI (their responses go back to the host) */
  private readonly hostRequests = new Set<RequestId>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private resolveDone: () => void = () => {};
  readonly done: Promise<void> = new Promise((r) => (this.resolveDone = r));

  private readonly d: AdaptiveFrontDeps;

  constructor(deps: AdaptiveFrontDeps) {
    this.d = deps;
  }

  get mode(): "solo" | "forward" {
    return this.att ? "forward" : "solo";
  }

  async start(): Promise<void> {
    const { local, solo } = this.d;
    local.onmessage = (m) => this.serial(() => this.fromLocal(m));
    solo.onmessage = (m) => void this.fromSolo(m);
    local.onclose = () => void this.close();
    local.onerror = (e) => this.d.log(`slidecraft mcp: local error — ${e.message}\n`);
    solo.onerror = (e) => this.d.log(`slidecraft mcp: solo error — ${e.message}\n`);
    await solo.start();
    await local.start();
  }

  /** Local messages are handled one at a time, in order (a decision may read host.json, ping and attach). */
  private serial(fn: () => Promise<void>): void {
    this.queue = this.queue.then(fn).catch((e: unknown) => this.d.log(`slidecraft mcp: ${e instanceof Error ? e.message : String(e)}\n`));
  }

  private async fromLocal(m: JSONRPCMessage): Promise<void> {
    if (isJSONRPCRequest(m)) {
      if (m.method === "initialize") {
        this.init = initParamsOf(m.params); // the ONE place clientInfo is remembered (ADR-0040 D2 / ADR-0038)
        return this.toSolo(m);
      }
      if (m.method === "tools/call" && !this.att) return this.soloCall(m);
      return this.route(m);
    }
    if (isJSONRPCNotification(m) && m.method === "notifications/initialized") return this.toSolo(m); // the AI↔solo handshake
    if (isResponse(m) && this.att && this.hostRequests.delete(m.id)) return this.forward(m);
    return this.route(m);
  }

  private async route(m: JSONRPCMessage): Promise<void> {
    if (this.att) return this.forward(m);
    if (isJSONRPCRequest(m) && m.method === "tools/call") return this.soloCall(m);
    return this.toSolo(m);
  }

  /** A tool call while solo: decide in front of it (ADR-0040 D2). */
  private async soloCall(m: JSONRPCMessage & { id: RequestId }): Promise<void> {
    const docId = this.d.soloDeckDocId();
    const step = decideSoloCall({ soloHasDeck: docId !== null, live: await this.d.watch.live(), deniedKey: this.deniedKey });
    if (step.kind === "attach" && (await this.tryAttach(step.host))) return this.forward(m);
    const note = step.kind === "solo" ? step.note ?? this.takePendingNote() : this.takePendingNote();
    if (note) this.soloNotes.set(m.id, frontNoteText(note, { docId: docId ?? undefined }));
    return this.toSolo(m);
  }

  private takePendingNote(): FrontNote | undefined {
    const n = this.pendingNote;
    this.pendingNote = undefined;
    return n;
  }

  private async toSolo(m: JSONRPCMessage): Promise<void> {
    await this.d.solo.send(m);
  }

  private async fromSolo(m: JSONRPCMessage): Promise<void> {
    if (isResponse(m)) {
      const note = this.soloNotes.get(m.id);
      if (note !== undefined) {
        this.soloNotes.delete(m.id);
        const r = m as { result?: ToolResult };
        if (r.result?.content) m = { ...m, result: withNote(r.result, note) } as JSONRPCMessage;
      }
    }
    await this.send(m);
  }

  private async send(m: JSONRPCMessage): Promise<void> {
    if (this.closed) return;
    await this.d.local.send(m).catch((e: unknown) => this.d.log(`slidecraft mcp: local send failed — ${e instanceof Error ? e.message : String(e)}\n`));
  }

  private async tryAttach(host: HostHandshake): Promise<boolean> {
    let att: Attachment;
    try {
      att = await this.d.attach(host, this.init);
    } catch (e) {
      this.d.watch.markDead(host); // not retried until host.json changes (no timeout on every call)
      this.d.log(`slidecraft mcp: could not connect to the GUI host at ${host.url} — staying solo (${e instanceof Error ? e.message : String(e)})\n`);
      return false;
    }
    att.wire.onmessage = (msg) => void this.fromHost(att, msg);
    att.wire.onerror = (e) => this.d.log(`slidecraft mcp (forward): host error — ${e.message}\n`);
    this.att = att;
    this.pendingNote = undefined;
    this.d.log(forwardBanner(host.url)); // the same line --doctor parses (cli-banner.ts, R8)
    await this.send(LIST_CHANGED);
    return true;
  }

  /** Leave forward mode (the router never holds two hosts). */
  private async detach(att: Attachment): Promise<void> {
    if (this.att === att) this.att = undefined;
    await att.close().catch(() => {});
  }

  private async forward(m: JSONRPCMessage): Promise<void> {
    const att = this.att!;
    if (isJSONRPCRequest(m) && m.method === "tools/call") this.forwarded.set(m.id, att);
    // Not awaited inside the queue beyond the send itself: a failure re-enters the queue as "host lost".
    att.wire.send(m).catch((e: unknown) => this.serial(() => this.hostLost(att, m, e)));
  }

  /** Sending to `att` failed: the host stopped answering (ADR-0040 D2, forward row). */
  private async hostLost(att: Attachment, m: JSONRPCMessage, e: unknown): Promise<void> {
    if (isJSONRPCRequest(m)) this.forwarded.delete(m.id);
    if (this.att === att) {
      this.d.log(`slidecraft mcp: the GUI host at ${att.host.url} stopped answering (${e instanceof Error ? e.message : String(e)})\n`);
      await this.detach(att);
      this.d.watch.markDead(att.host);
      const step = decideHostLost(await this.d.watch.live(), att.host);
      if (!(step.kind === "attach" && (await this.tryAttach(step.host)))) {
        this.pendingNote = "host-lost";
        this.d.log("slidecraft mcp: back to solo (no deck)\n");
        await this.send(LIST_CHANGED);
      }
    }
    return this.route(m); // this very message, under the new mode
  }

  private async fromHost(att: Attachment, m: JSONRPCMessage): Promise<void> {
    if (isJSONRPCRequest(m)) {
      if (this.att !== att) return; // a stale host asks nothing of the AI
      this.hostRequests.add(m.id);
      return this.send(m);
    }
    if (!isResponse(m)) return this.att === att ? this.send(m) : undefined; // notifications of a stale host are dropped
    const via = this.forwarded.get(m.id);
    if (via === att) {
      this.forwarded.delete(m.id);
      const code = codeOf((m as { result?: unknown }).result);
      const note = await this.afterForwardedCall(att, code);
      if (note) {
        const r = m as { result?: ToolResult };
        if (r.result?.content) m = { ...m, result: withNote(r.result, frontNoteText(note, {})) } as JSONRPCMessage;
      }
    }
    return this.send(m);
  }

  /** ADR-0040 D3-3/D3-5: what a forwarded call's outcome means for the adapter. */
  private async afterForwardedCall(att: Attachment, code: string | undefined): Promise<FrontNote | undefined> {
    if (code === "authorization-pending") return undefined; // the host's text already asks for [許可]
    if (code === "authorization-denied") {
      this.deniedKey = hostKey(att.host);
      if (this.att === att) {
        await this.detach(att);
        this.d.log("slidecraft mcp: the GUI denied this client — staying solo\n");
        await this.send(LIST_CHANGED);
      }
      return "denied-stay-solo";
    }
    if (code === "authorization-revoked") {
      att.forgetSecret();
      if (this.att === att) {
        await this.detach(att);
        this.serial(async () => {
          if (!this.att && !(await this.tryAttach(att.host))) await this.send(LIST_CHANGED);
        });
      }
      return "reapplied";
    }
    void att.afterAdmitted(); // admitted: keep the secret for the next launch (once)
    return undefined;
  }

  /** The AI went away (stdin ended / transport closed): drop the host connection too, so nothing keeps the
   *  process alive (an open SSE stream to the host would). */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.att) await this.detach(this.att);
    await this.d.solo.close().catch(() => {});
    this.resolveDone();
  }
}
