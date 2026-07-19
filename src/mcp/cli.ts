/**
 * cli.ts — `slidecraft serve` / `slidecraft mcp`: the single client-facing stdio entry an upstream
 * agent spawns (ADR-0033 D2: an "adaptive front"). At startup it DISCOVERS whether a GUI-hosted
 * collab listener is already running (`host-discovery.ts`, reading the same `host.json` the Tauri
 * supervisor writes — `src-tauri/src/collab.rs:120`):
 *
 *  - LIVE host found → FORWARD mode: a stateless bidirectional relay (`mcp-relay.ts`) between this
 *    stdio session and the host's HTTP endpoint. Deck state and undo history live ONLY in the host's
 *    DocRegistry — forward never becomes a second control plane.
 *  - no host / stale entry → SOLO mode: byte-identical to D1 — a `createSoloHostContext` control
 *    plane wraps a fresh Session, with commitMutation/undo pinned to that one doc.
 *
 * Rendezvous is decided ONCE, at startup (no live re-attach if a GUI launches mid-session — that's
 * D2's explicit scope cut, tracked as a future refinement).
 *
 * v1 is --no-fs (the default and only mode): the .scft / .pptx bytes flow as base64
 * over stdio, so the server reads/writes NO files — the trust boundary is just the agent
 * that spawned it (OS-user / inherited stdio; solo carries no token — that's HTTP-only,
 * host-security.ts). Reading host.json for discovery is a DELIBERATE, narrow exception to
 * --no-fs's "no filesystem" posture: it's a one-shot read of a fixed, 0600 handshake file to decide
 * a rendezvous, not access to deck content (ADR-0007/ADR-0033). A scoped --root mode remains
 * reserved for later.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSession } from "./session";
import { buildServer } from "./server";
import { createSoloHostContext } from "./host-core";
import { resolveHostJsonPath, discoverLiveHost } from "./host-discovery";
import { runRelay } from "./mcp-relay";

async function runSolo(): Promise<void> {
  const session = createSession(null); // --no-fs: no filesystem; bytes flow as base64
  const host = createSoloHostContext(session); // solo control plane: one doc, sole-doc resolution, no token
  const server = buildServer(session, { host, registerResources: true });
  await server.connect(new StdioServerTransport());
  process.stderr.write("slidecraft mcp: ready (solo stdio, --no-fs / base64)\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--root")) {
    process.stderr.write(
      "slidecraft serve: --root（scoped fs）は次バージョンで対応予定です。v1 は --no-fs（base64 over stdio）のみ。\n",
    );
    process.exit(2);
  }

  const live = await discoverLiveHost(resolveHostJsonPath());
  if (live) {
    process.stderr.write(`slidecraft mcp: forwarding to live host at ${live.url}\n`);
    await runRelay(live);
    return;
  }
  await runSolo();
}

main().catch((e: unknown) => {
  process.stderr.write(`slidecraft mcp: fatal — ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
