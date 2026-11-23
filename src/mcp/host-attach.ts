/**
 * host-attach.ts — #728 (ADR-0040 D2/D3-4): the adapter's OWN handshake with a GUI host when it switches from solo
 * to forward mid-session. The AI's `initialize` was answered by the solo server long ago, so the host never saw
 * it: the adapter replays the remembered clientInfo in its own `initialize`, and applies for approval with it.
 *
 * What travels (the contract of #727's host side — host.ts applicationOf / handleAuth, tests/host-approval-http):
 *  - always: `x-slidecraft-client-id` (credential file) + `x-slidecraft-client-claim` (a one-time value kept in
 *    memory only — after [許可], only this process can exchange it for the secret: D3-4 "渡す相手");
 *  - if a secret is kept for this clientInfo version: a fresh nonce (POST /auth/nonce) and the HMAC proof
 *    (host-approval.proofFor — the SAME function the host checks with, R8). The secret itself is never sent.
 * These headers ride the `initialize` POST only (the host reads them there), not every later request.
 */
import { randomBytes } from "crypto";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { proofFor, type ClientInfo } from "./host-approval";
import type { CredentialFile } from "./client-credentials";
import type { HostHandshake } from "./host-json";

/** Structural subset of the SDK's Transport (same shape as mcp-relay's RelayTransport). */
export interface FrontWire {
  start(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  close(): Promise<void>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  setProtocolVersion?: (version: string) => void;
}

/** What the adapter remembers from the AI's `initialize` — the ONE place clientInfo is taken from (ADR-0038:
 *  when `initialize` goes away, only this extraction changes). Missing → "不明なクライアント" (ADR-0040 D2). */
export interface InitParams {
  protocolVersion?: string;
  capabilities?: unknown;
  clientInfo: ClientInfo;
}

export function initParamsOf(params: unknown): InitParams {
  const p = (params ?? {}) as { protocolVersion?: unknown; capabilities?: unknown; clientInfo?: { name?: unknown; version?: unknown } };
  const name = typeof p.clientInfo?.name === "string" && p.clientInfo.name.trim() ? p.clientInfo.name : "不明なクライアント";
  const version = typeof p.clientInfo?.version === "string" && p.clientInfo.version.trim() ? p.clientInfo.version : "?";
  return { protocolVersion: typeof p.protocolVersion === "string" ? p.protocolVersion : undefined, capabilities: p.capabilities, clientInfo: { name, version } };
}

export interface Attachment {
  host: HostHandshake;
  /** started and initialized; the router sets onmessage */
  wire: FrontWire;
  /** After a call was admitted: exchange the one-time claim for the secret and keep it (once; no-op after). */
  afterAdmitted(): Promise<void>;
  /** The grant was revoked (D3-5): drop the kept secret, so the next attach applies afresh. */
  forgetSecret(): void;
  close(): Promise<void>;
}

const HANDSHAKE_ID = "slidecraft-adapter-initialize";

/** `initialize` → result → `notifications/initialized` over a started wire. Rejects on an error reply or timeout. */
export async function handshake(wire: FrontWire, init: InitParams, timeoutMs: number): Promise<void> {
  const prev = wire.onmessage;
  try {
    const reply = new Promise<JSONRPCMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`initialize timed out after ${timeoutMs} ms`)), timeoutMs);
      wire.onmessage = (m) => {
        if ("id" in m && m.id === HANDSHAKE_ID) {
          clearTimeout(timer);
          resolve(m);
        }
      };
    });
    await wire.send({
      jsonrpc: "2.0",
      id: HANDSHAKE_ID,
      method: "initialize",
      params: { protocolVersion: init.protocolVersion ?? LATEST_PROTOCOL_VERSION, capabilities: init.capabilities ?? {}, clientInfo: init.clientInfo },
    });
    const m = (await reply) as { result?: { protocolVersion?: string }; error?: { message?: string } };
    if (m.error || !m.result) throw new Error(`host refused initialize: ${m.error?.message ?? "no result"}`);
    if (m.result.protocolVersion) wire.setProtocolVersion?.(m.result.protocolVersion);
    await wire.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  } finally {
    wire.onmessage = prev;
  }
}

export interface AttachOptions {
  /** bound for each step (nonce, initialize); default 5 s */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Connect to `host` as the AI described by `init`, applying for (or proving) approval. Rejects if the host does
 *  not answer — the router then stays (or goes back to) solo. */
export async function attachHost(host: HostHandshake, init: InitParams, creds: CredentialFile, opts: AttachOptions = {}): Promise<Attachment> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const doFetch = opts.fetchImpl ?? fetch;
  const auth = { authorization: `Bearer ${host.token}` };
  const post = (path: string, body: unknown): Promise<Response> =>
    doFetch(new URL(path, host.url), { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });

  const cred = creds.ensure();
  const info = init.clientInfo;
  const claim = randomBytes(24).toString("base64url"); // memory only (D3-4)
  const apply: Record<string, string> = { "x-slidecraft-client-id": cred.clientId, "x-slidecraft-client-claim": claim };
  if (cred.secret && cred.version === info.version) {
    const r = await post("/auth/nonce", {});
    if (!r.ok) throw new Error(`host refused a nonce (HTTP ${r.status})`);
    const { nonce } = (await r.json()) as { nonce: string };
    apply["x-slidecraft-client-nonce"] = nonce;
    apply["x-slidecraft-client-proof"] = proofFor(cred.secret, nonce, cred.clientId, info);
  }

  // The application headers ride the FIRST POST — the initialize — only.
  let applied = false;
  const fetchWithApply: typeof fetch = (url, req) => {
    if (applied || req?.method !== "POST") return doFetch(url, req);
    applied = true;
    return doFetch(url, { ...req, headers: { ...Object.fromEntries(new Headers(req.headers).entries()), ...apply } });
  };
  const transport = new StreamableHTTPClientTransport(new URL(host.url), { requestInit: { headers: auth }, fetch: fetchWithApply });
  const wire: FrontWire = transport;
  try {
    await wire.start();
    await handshake(wire, init, timeoutMs);
  } catch (e) {
    await transport.close().catch(() => {});
    throw e;
  }

  let redeemed = false;
  return {
    host,
    wire,
    afterAdmitted: async () => {
      if (redeemed) return;
      redeemed = true;
      try {
        const r = await post("/auth/claim", { clientId: cred.clientId, claim });
        if (!r.ok) return; // approved by proof (nothing to claim), or another applicant's claim — nothing to keep
        const { secret } = (await r.json()) as { secret?: unknown };
        if (typeof secret === "string" && secret) creds.saveSecret(info.version, secret);
      } catch {
        /* the host went away; the next attach applies again */
      }
    },
    forgetSecret: () => creds.clearSecret(),
    close: () => transport.close(),
  };
}
