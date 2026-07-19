/**
 * mcp-relay.ts — ADR-0033 D2's forward mode: a STATELESS, bidirectional JSON-RPC pass-through
 * between the stdio transport (the upstream AI — Claude Code/Cursor/Claude Desktop) and an
 * ALREADY-RUNNING collab host's Streamable HTTP endpoint. No McpServer/Client wrapper, no tool
 * re-registration, no deck state held here — raw Transport↔Transport wiring only, so forward mode
 * can never become a second control plane (ADR-0033's core invariant: the host's DocRegistry +
 * commitMutation stay the ONLY control plane; this file just pipes bytes).
 *
 * The host's own `mcp-session-id` (captured by StreamableHTTPClientTransport on the first response)
 * and its SSE stream carry BOTH request/response traffic AND server-initiated notifications
 * (deckChanged, documentOpened) straight through — the SDK transport already does this the moment
 * a `notifications/initialized` message is relayed, so no separate notification-forwarding code is
 * needed here (that would be exactly the kind of duplicated meaning R8 forbids).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { HostHandshake } from "./host-json";

/** Structural subset of the SDK's `Transport` interface (shared/transport.js) — declared locally
 *  instead of importing that module so this file doesn't pull in a new deep SDK import path; every
 *  concrete transport we use (StdioServerTransport, StreamableHTTPClientTransport, InMemoryTransport
 *  in tests) already satisfies this shape. */
interface RelayTransport {
  start(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  close(): Promise<void>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/** Wires the local (AI-facing) transport ⇄ the remote (host-facing) transport and resolves once
 *  either side closes (the other side is closed too, so the process can exit cleanly). A
 *  per-message relay failure surfaces via the transport's own `onerror` (logged, non-fatal) rather
 *  than tearing down the whole session.
 *
 *  `local` defaults to real stdio and `remote` to a real `StreamableHTTPClientTransport` pointed at
 *  the discovered host (production, cli.ts). Tests inject in-memory transports on EITHER side so the
 *  relay's forwarding logic can be driven deterministically, without a subprocess or real sockets. */
export function runRelay(
  handshake: HostHandshake,
  local: RelayTransport = new StdioServerTransport(),
  remote: RelayTransport = new StreamableHTTPClientTransport(new URL(handshake.url), {
    requestInit: { headers: { authorization: `Bearer ${handshake.token}` } },
  }),
): Promise<void> {
  local.onmessage = (message: JSONRPCMessage) => {
    void remote.send(message).catch((e: unknown) => remote.onerror?.(toError(e)));
  };
  remote.onmessage = (message: JSONRPCMessage) => {
    void local.send(message).catch((e: unknown) => local.onerror?.(toError(e)));
  };
  local.onerror = (e) => process.stderr.write(`slidecraft mcp (forward): local error — ${e.message}\n`);
  remote.onerror = (e) => process.stderr.write(`slidecraft mcp (forward): host error — ${e.message}\n`);

  return new Promise((resolve) => {
    // Guard against a close→onclose→close ping-pong: some Transport implementations (e.g. the
    // SDK's InMemoryTransport, used by tests) call the OTHER side's close() from within their own
    // close() AND fire onclose unconditionally on every call, even a redundant one. Without this
    // guard, our mutual onclose→close() wiring would re-trigger itself indefinitely.
    let closing = false;
    const closeOther = (which: RelayTransport): void => {
      if (closing) return;
      closing = true;
      void which.close().finally(() => resolve());
    };
    local.onclose = () => closeOther(remote);
    remote.onclose = () => closeOther(local);
    void remote.start().then(() => local.start());
  });
}
