/**
 * host-approval.ts — #727 (ADR-0040 D3): who may CALL tools on the always-on collab host. Holding the shared
 * token (host.json) now only lets a client APPLY; the human allows it in the GUI. Pure Node logic (crypto
 * only, no transport) so every state transition is unit-testable (tests/host-approval.test.ts).
 *
 * Key = the pair (clientInfo name+version, client id):
 *  - "adapter" (stdio `slidecraft mcp`, #728): the adapter's own persistent client id. After [許可] the host
 *    mints a per-pair secret; only the applicant can fetch it, by redeeming the one-time `claim` it sent with
 *    its application. Later launches PROVE the secret with an HMAC over a host-issued, single-use nonce —
 *    the secret itself never travels again. The GUI persists grants in the keychain (ADR-0016 F3) and hands
 *    them back over the GUI port (loadGrants) — never via argv (D3-8).
 *  - "session" (HTTP direct): the client can only send a bearer, so the approval is bound to the host-issued
 *    `mcp-session-id` and lives only as long as that session (D3-7).
 * Default deny: a request stays pending until [許可]; [拒否] is remembered for this launch; ≤3 requests may
 * wait at once (more are denied without a dialog); [この起動中はすべて拒否] denies everything from then on.
 * This is consent + visibility, NOT cryptographic identity: same-user malware stays out of scope (ADR-0040).
 */
import { createHash, createHmac, randomBytes } from "crypto";
import { safeEqual } from "./host-security";

export interface ClientInfo {
  name: string;
  version: string;
}

/** How a connection identifies itself when it applies (read from the `initialize` request). */
export type ApplyVia =
  | { kind: "adapter"; clientId: string; claim?: string; nonce?: string; proof?: string }
  | { kind: "session"; sessionId: string };

export type ConnStatus = "approved" | "pending" | "denied" | "revoked";
export type Decision = "allow" | "deny" | "deny-all";

/** A grant as the GUI persists it in the keychain. `secret` never appears in `view()`. */
export interface StoredGrant {
  name: string;
  version: string;
  clientId: string;
  secret: string;
}

export interface PendingView {
  requestId: string;
  name: string;
  version: string;
  /** first 8 chars of the client id (adapter) or of the mcp-session-id (session) — tells look-alikes apart */
  fingerprint: string;
  kind: ApplyVia["kind"];
}

export interface GrantView {
  /** opaque handle for revoke() */
  key: string;
  name: string;
  version: string;
  fingerprint: string;
  kind: ApplyVia["kind"];
  /** adapter grants: the full client id (not a secret — it travels in a header) so the GUI can drop that pair
   *  from the keychain on revoke */
  clientId?: string;
}

export interface ApprovalView {
  pending: PendingView[];
  grants: GrantView[];
  denyAll: boolean;
}

/** The HMAC an adapter sends to prove it holds the pair's secret. Bound to the nonce AND the pair, so a proof
 *  can be neither replayed (single-use nonce) nor moved to another name/version/client id. */
export function proofFor(secret: string, nonce: string, clientId: string, info: ClientInfo): string {
  return createHmac("sha256", secret).update(["slidecraft-client-auth-v1", nonce, clientId, info.name, info.version].join("\n")).digest("base64url");
}

export const MAX_PENDING = 3;
const NONCE_TTL_MS = 60_000;

interface Request {
  requestId: string;
  pairKey: string;
  info: ClientInfo;
  via: ApplyVia;
  conns: Set<string>;
  /** sha256(claim) of every applicant in this request — each can redeem the secret once after [許可] */
  claims: Set<string>;
}

interface Grant {
  key: string;
  pairKey: string;
  info: ClientInfo;
  kind: ApplyVia["kind"];
  fingerprint: string;
  /** adapter grants only */
  stored?: StoredGrant;
}

interface Conn {
  status: ConnStatus;
  pairKey: string;
  /** the grant that approved this connection (revoke → "revoked") */
  grantKey?: string;
  /** an adapter proof we could not check yet (grants not loaded) — re-checked by loadGrants */
  proof?: { info: ClientInfo; clientId: string; nonce: string; proof: string };
}

const sha = (s: string): string => createHash("sha256").update(s).digest("base64url");
const pairKeyOf = (info: ClientInfo, via: ApplyVia): string =>
  JSON.stringify([via.kind, info.name, info.version, via.kind === "adapter" ? via.clientId : via.sessionId]);
const fingerprintOf = (via: ApplyVia): string => (via.kind === "adapter" ? via.clientId : via.sessionId).slice(0, 8);

export interface ApprovalBookOptions {
  maxPending?: number;
  nonceTtlMs?: number;
  now?: () => number;
  /** fired after every state change the GUI should see (the host broadcasts a notification) */
  onChange?: () => void;
}

export class ApprovalBook {
  private readonly requests = new Map<string, Request>(); // requestId → request
  private readonly grants = new Map<string, Grant>(); // grant key → grant
  private readonly conns = new Map<string, Conn>();
  private readonly denied = new Set<string>(); // pairKeys denied for this launch
  private readonly nonces = new Map<string, number>(); // nonce → expiry
  private readonly claimSecrets = new Map<string, { clientId: string; secret: string }>(); // sha(claim) → secret
  private readonly waiters = new Map<string, (() => void)[]>(); // connId → wake-ups
  private denyAll = false;
  private readonly maxPending: number;
  private readonly nonceTtlMs: number;
  private readonly now: () => number;
  private readonly onChange: () => void;

  constructor(opts: ApprovalBookOptions = {}) {
    this.maxPending = opts.maxPending ?? MAX_PENDING;
    this.nonceTtlMs = opts.nonceTtlMs ?? NONCE_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange ?? (() => {});
  }

  issueNonce(): string {
    const t = this.now();
    for (const [n, exp] of this.nonces) if (exp <= t) this.nonces.delete(n);
    const nonce = randomBytes(24).toString("base64url");
    this.nonces.set(nonce, t + this.nonceTtlMs);
    return nonce;
  }

  /** Record a connection's application (at `initialize`) and return its status. */
  apply(connId: string, info: ClientInfo, via: ApplyVia): ConnStatus {
    const pairKey = pairKeyOf(info, via);
    const conn: Conn = { status: "pending", pairKey };
    this.conns.set(connId, conn);
    let proofOk = false;
    if (via.kind === "adapter" && via.nonce && via.proof) {
      const fresh = this.consumeNonce(via.nonce);
      const grant = this.grantFor(pairKey);
      if (fresh && grant?.stored) proofOk = safeEqual(via.proof, proofFor(grant.stored.secret, via.nonce, via.clientId, info));
      else if (fresh && !grant) conn.proof = { info, clientId: via.clientId, nonce: via.nonce, proof: via.proof };
      if (proofOk) {
        conn.status = "approved";
        conn.grantKey = grant!.key;
      }
    }
    if (!proofOk) {
      if (this.denyAll || this.denied.has(pairKey)) conn.status = "denied";
      else this.enqueue(connId, pairKey, info, via);
    }
    this.onChange();
    return conn.status;
  }

  status(connId: string): ConnStatus | undefined {
    return this.conns.get(connId)?.status;
  }

  /** Resolve once the connection is no longer pending, or after `ms` (then it reports "pending"). */
  waitSettled(connId: string, ms: number): Promise<ConnStatus | undefined> {
    if (this.status(connId) !== "pending") return Promise.resolve(this.status(connId));
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        resolve(this.status(connId));
      };
      const timer = setTimeout(() => {
        this.waiters.set(connId, (this.waiters.get(connId) ?? []).filter((w) => w !== done));
        resolve(this.status(connId));
      }, ms);
      this.waiters.set(connId, [...(this.waiters.get(connId) ?? []), done]);
    });
  }

  /** The human's answer to a request. `allow` on an adapter request returns the grant to persist. */
  decide(requestId: string, decision: Decision): { grant?: StoredGrant } {
    const req = this.requests.get(requestId);
    if (!req) return {};
    this.requests.delete(requestId);
    if (decision !== "allow") {
      this.denied.add(req.pairKey);
      this.settle(req.conns, "denied");
      if (decision === "deny-all") {
        this.denyAll = true;
        for (const r of [...this.requests.values()]) {
          this.requests.delete(r.requestId);
          this.denied.add(r.pairKey);
          this.settle(r.conns, "denied");
        }
      }
      this.onChange();
      return {};
    }
    let stored: StoredGrant | undefined;
    if (req.via.kind === "adapter") {
      stored = { name: req.info.name, version: req.info.version, clientId: req.via.clientId, secret: randomBytes(32).toString("base64url") };
      for (const c of req.claims) this.claimSecrets.set(c, { clientId: stored.clientId, secret: stored.secret });
    }
    const grant = this.addGrant(req.pairKey, req.info, req.via, stored);
    this.settle(req.conns, "approved", grant.key);
    this.onChange();
    return stored ? { grant: stored } : {};
  }

  /** Exchange the applicant's one-time claim for its secret (once, after [許可]). */
  redeemClaim(clientId: string, claim: string): string | undefined {
    const h = sha(claim);
    const hit = this.claimSecrets.get(h);
    if (!hit || !safeEqual(hit.clientId, clientId)) return undefined;
    this.claimSecrets.delete(h);
    return hit.secret;
  }

  /** REPLACE the persisted adapter grants with the GUI's keychain copy, and re-check proofs that arrived first. */
  loadGrants(list: StoredGrant[]): void {
    const keep = new Set(list.map((s) => pairKeyOf(s, { kind: "adapter", clientId: s.clientId })));
    // A grant the keychain no longer holds is revoked (its connections learn it on their next call).
    for (const g of [...this.grants.values()]) if (g.kind === "adapter" && !keep.has(g.pairKey)) this.revokeQuietly(g.key);
    for (const s of list) this.addGrant(pairKeyOf(s, { kind: "adapter", clientId: s.clientId }), { name: s.name, version: s.version }, { kind: "adapter", clientId: s.clientId }, s);
    for (const [connId, c] of this.conns) {
      if (c.status !== "pending" || !c.proof) continue;
      const grant = this.grantFor(c.pairKey);
      if (grant?.stored && safeEqual(c.proof.proof, proofFor(grant.stored.secret, c.proof.nonce, c.proof.clientId, c.proof.info))) {
        this.withdraw(connId);
        this.settle([connId], "approved", grant.key);
      }
      c.proof = undefined;
    }
    this.onChange();
  }

  /** Revoke a grant: its connections become "revoked" (their next call says so) and its secret is void. */
  revoke(key: string): boolean {
    if (!this.revokeQuietly(key)) return false;
    this.onChange();
    return true;
  }

  private revokeQuietly(key: string): boolean {
    const g = this.grants.get(key);
    if (!g) return false;
    this.grants.delete(key);
    for (const [h, v] of this.claimSecrets) if (g.stored && v.secret === g.stored.secret) this.claimSecrets.delete(h);
    for (const c of this.conns.values()) if (c.grantKey === key) c.status = "revoked";
    return true;
  }

  /** A connection closed: drop it, its pending application and its session-bound grant. */
  forget(connId: string): void {
    const c = this.conns.get(connId);
    if (!c) return;
    this.withdraw(connId);
    if (c.grantKey && this.grants.get(c.grantKey)?.kind === "session") this.grants.delete(c.grantKey);
    this.conns.delete(connId);
    this.waiters.delete(connId);
    this.onChange();
  }

  view(): ApprovalView {
    return {
      pending: [...this.requests.values()].map((r) => ({ requestId: r.requestId, name: r.info.name, version: r.info.version, fingerprint: fingerprintOf(r.via), kind: r.via.kind })),
      grants: [...this.grants.values()].map((g) => ({ key: g.key, name: g.info.name, version: g.info.version, fingerprint: g.fingerprint, kind: g.kind, ...(g.stored ? { clientId: g.stored.clientId } : {}) })),
      denyAll: this.denyAll,
    };
  }

  private consumeNonce(nonce: string): boolean {
    const exp = this.nonces.get(nonce);
    this.nonces.delete(nonce);
    return exp !== undefined && exp > this.now();
  }

  private grantFor(pairKey: string): Grant | undefined {
    for (const g of this.grants.values()) if (g.pairKey === pairKey) return g;
    return undefined;
  }

  private addGrant(pairKey: string, info: ClientInfo, via: ApplyVia, stored?: StoredGrant): Grant {
    // Same pair → same key (a re-load or re-allow must not orphan the connections it approved earlier).
    const old = this.grantFor(pairKey);
    if (old) this.grants.delete(old.key);
    const grant: Grant = { key: old?.key ?? randomBytes(12).toString("base64url"), pairKey, info, kind: via.kind, fingerprint: fingerprintOf(via), stored };
    this.grants.set(grant.key, grant);
    return grant;
  }

  private enqueue(connId: string, pairKey: string, info: ClientInfo, via: ApplyVia): void {
    const claim = via.kind === "adapter" && via.claim ? sha(via.claim) : undefined;
    const same = [...this.requests.values()].find((r) => r.pairKey === pairKey);
    if (same) {
      same.conns.add(connId);
      if (claim) same.claims.add(claim);
      return;
    }
    if (this.requests.size >= this.maxPending) {
      this.conns.get(connId)!.status = "denied"; // over the cap: denied without a dialog (not remembered)
      return;
    }
    const requestId = randomBytes(12).toString("base64url");
    this.requests.set(requestId, { requestId, pairKey, info, via, conns: new Set([connId]), claims: new Set(claim ? [claim] : []) });
  }

  /** Remove the connection from any request; a request nobody waits for any more is withdrawn. */
  private withdraw(connId: string): void {
    for (const r of [...this.requests.values()]) {
      if (!r.conns.delete(connId)) continue;
      if (r.conns.size === 0) this.requests.delete(r.requestId);
    }
  }

  private settle(connIds: Iterable<string>, status: ConnStatus, grantKey?: string): void {
    for (const id of connIds) {
      const c = this.conns.get(id);
      if (!c) continue;
      c.status = status;
      c.grantKey = grantKey;
      for (const w of this.waiters.get(id) ?? []) w();
      this.waiters.delete(id);
    }
  }
}

/** The GUI's port onto approval + the seed handshake (GUI-only tools in approval-tools.ts; wired by host.ts). */
export interface ApprovalPort {
  view(): ApprovalView & { aiActive: boolean };
  decide(requestId: string, decision: Decision): { grant?: StoredGrant };
  loadGrants(grants: StoredGrant[]): void;
  revoke(key: string): boolean;
  reportSeed(state: "pending" | "done" | "failed", error?: string): void;
}
