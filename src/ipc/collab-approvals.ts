/**
 * collab-approvals.ts — #727 (ADR-0040 D1/D3): the GUI's approval channel. A SECOND GUI-token connection next to
 * the deck projection (collab-projection.ts stays about the deck): it keeps an up-to-date snapshot of waiting AI
 * clients + allowed clients (push `clientApprovalsChanged`, with a poll floor because SSE over plugin-http is not
 * guaranteed — the projection does the same for decks), answers requests, hands the keychain grants to the host
 * (load_client_grants — never argv, D3-8), reports the deck seed, and tells the hook once an allowed AI started
 * calling (`aiActive` → seed + edit lock). No React here; useCollab wires it.
 */
import { CollabClient } from "./collab-client";
import type { ApprovalView, Decision, StoredGrant } from "../mcp/host-approval";

export type ApprovalSnapshot = ApprovalView & { aiActive: boolean };

export interface CollabApprovalsOptions {
  url: string;
  guiToken: string;
  fetch?: typeof fetch;
  /** poll interval (ms) for the snapshot floor; 0 = push only (tests). Default 1200. */
  pollMs?: number;
  onView(v: ApprovalSnapshot): void;
  /** fired once per host launch, when an allowed AI made its first call */
  onAiActive(): void;
}

export class CollabApprovals {
  private readonly opts: CollabApprovalsOptions;
  private readonly client: CollabClient;
  private poll: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private closed = false;

  constructor(opts: CollabApprovalsOptions) {
    this.opts = opts;
    this.client = new CollabClient({
      url: opts.url,
      token: opts.guiToken,
      fetch: opts.fetch,
      events: {
        onClientApprovalsChanged: () => void this.refresh().catch(() => {}),
        onAiActive: () => {
          this.markActive();
          void this.refresh().catch(() => {});
        },
      },
    });
  }

  async start(): Promise<void> {
    await this.client.connect();
    await this.refresh();
    const ms = this.opts.pollMs ?? 1200;
    if (ms > 0) this.poll = setInterval(() => void this.refresh().catch(() => {}), ms);
  }

  async stop(): Promise<void> {
    this.closed = true;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    try {
      await this.client.close();
    } catch {
      /* ignore */
    }
  }

  /** Pull the snapshot now (also what push and poll do). */
  async refresh(): Promise<ApprovalSnapshot> {
    const v = await this.client.callTool<ApprovalSnapshot>("list_client_approvals");
    if (!this.closed) {
      if (v.aiActive) this.markActive();
      this.opts.onView(v);
    }
    return v;
  }

  /** Answer a request. Allowing a stdio adapter returns the grant the GUI must keep (keychain). */
  async decide(requestId: string, decision: Decision): Promise<StoredGrant | undefined> {
    const r = await this.client.callTool<{ grant?: StoredGrant }>("decide_client_approval", { requestId, decision });
    await this.refresh();
    return r.grant;
  }

  async revoke(key: string): Promise<boolean> {
    const r = await this.client.callTool<{ ok: boolean }>("revoke_client_approval", { key });
    await this.refresh();
    return r.ok;
  }

  async loadGrants(grants: StoredGrant[]): Promise<void> {
    await this.client.callTool("load_client_grants", { grants });
  }

  async reportSeed(state: "pending" | "done" | "failed", error?: string): Promise<void> {
    await this.client.callTool("report_seed", error ? { state, error } : { state });
  }

  private markActive(): void {
    if (this.active || this.closed) return;
    this.active = true;
    this.opts.onAiActive();
  }
}
