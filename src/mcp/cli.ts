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
 * The default mode is --no-fs: the .scft / .pptx bytes flow as base64 over stdio, so the server
 * reads/writes NO files — the trust boundary is just the agent that spawned it (OS-user / inherited
 * stdio; solo carries no token — that's HTTP-only, host-security.ts). Reading host.json for
 * discovery is a DELIBERATE, narrow exception to --no-fs's "no filesystem" posture: it's a one-shot
 * read of a fixed, 0600 handshake file to decide a rendezvous, not access to deck content
 * (ADR-0007/ADR-0033).
 *
 * ADR-0035 stage 1 (output side, #299): `--root <dir>` opts into a SCOPED fs mode — export_pptx /
 * save_project then write under that one directory and return a path instead of base64
 * (fs-scope.ts). --no-fs (base64) stays the byte-identical default when --root is absent. Input-side
 * fs (open_project/new_project) and the loopback-binary data plane remain follow-up work.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSession } from "./session";
import { buildServer } from "./server";
import { createSoloHostContext } from "./host-core";
import { resolveHostJsonPath, discoverLiveHost } from "./host-discovery";
import { runRelay } from "./mcp-relay";
import { resolveScopeRoot } from "./fs-scope";

async function runSolo(root: string | null): Promise<void> {
  const session = createSession(root); // root===null: --no-fs, bytes flow as base64; else scoped fs (ADR-0035)
  const host = createSoloHostContext(session); // solo control plane: one doc, sole-doc resolution, no token
  const server = buildServer(session, { host, registerResources: true });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`slidecraft mcp: ready (solo stdio, ${root ? `scoped fs — root=${root}` : "--no-fs / base64"})\n`);
}

/** `--root <dir>` — the flag's argument, or undefined if the flag wasn't passed. A present-but-empty
 *  argument (missing value / another flag right after) is a usage error, never-silently ignored. */
function parseRootArg(argv: string[]): string | undefined {
  const idx = argv.indexOf("--root");
  if (idx === -1) return undefined;
  const dir = argv[idx + 1];
  if (!dir || dir.startsWith("--")) {
    process.stderr.write("slidecraft serve: --root にはディレクトリパスが必要です（例: --root /path/to/scope）。\n");
    process.exit(2);
  }
  return dir;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let root: string | null = null;
  const rootArg = parseRootArg(argv);
  if (rootArg !== undefined) {
    try {
      root = resolveScopeRoot(rootArg);
    } catch (e) {
      process.stderr.write(`slidecraft serve: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(2);
    }
  }

  const live = await discoverLiveHost(resolveHostJsonPath());
  if (live) {
    // Forward mode hands the session to the GUI host's own control plane — this stdio process
    // writes nothing, so a --root scope has no effect there (never-silently dropped: told, not hidden).
    if (root) process.stderr.write("slidecraft mcp: note — --root is ignored while forwarding to a live GUI host (deck state lives in the host process).\n");
    process.stderr.write(`slidecraft mcp: forwarding to live host at ${live.url}\n`);
    await runRelay(live);
    return;
  }
  await runSolo(root);
}

main().catch((e: unknown) => {
  process.stderr.write(`slidecraft mcp: fatal — ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
