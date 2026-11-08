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
import { resolve as resolvePath } from "path";
import { createSession } from "./session";
import { buildServer } from "./server";
import { createSoloHostContext } from "./host-core";
import { resolveHostJsonPath, discoverLiveHost } from "./host-discovery";
import { runRelay } from "./mcp-relay";
import { resolveScopeRoot } from "./fs-scope";
import { createProbeAwareStdio } from "./discover-probe";
import { createFileMetricsRecorder } from "./metrics-sink";
import { soloReadyBanner, forwardBanner } from "./cli-banner";
import { runDoctor } from "./doctor";

async function runSolo(root: string | null, metricsPath: string | undefined): Promise<void> {
  const session = createSession(root); // root===null: --no-fs, bytes flow as base64; else scoped fs (ADR-0035)
  const host = createSoloHostContext(session); // solo control plane: one doc, sole-doc resolution, no token
  // #512: --metrics <path> opts into a LOCAL JSONL call log (no egress — ADR-0016). Absent = OFF:
  // no recorder, handlers unwrapped, nothing written anywhere.
  const metrics = metricsPath ? createFileMetricsRecorder(resolvePath(metricsPath)) : undefined;
  const server = buildServer(session, { host, registerResources: true, metrics });
  // #518: the 2026-07-28 `server/discover` probe is answered in front of the SDK (discover-probe.ts);
  // every other line reaches the SDK transport byte-for-byte, so the legacy handshake is unchanged.
  await server.connect(createProbeAwareStdio());
  process.stderr.write(soloReadyBanner(root, metricsPath ? resolvePath(metricsPath) : undefined));
}

/** `--<flag> <value>` — the flag's argument, or undefined if the flag wasn't passed. A present-but-empty
 *  argument (missing value / another flag right after) is a usage error, never-silently ignored. */
function parseValueFlag(argv: string[], flag: string, usage: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const v = argv[idx + 1];
  if (!v || v.startsWith("--")) {
    process.stderr.write(`slidecraft serve: ${usage}\n`);
    process.exit(2);
  }
  return v;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // #517: `--doctor` diagnoses instead of serving — it spawns this same server (with the other flags) and
  // prints one screen; exit 0 = a client can connect. --root etc. are validated by that child, not here.
  if (argv.includes("--doctor")) {
    const { report, text } = await runDoctor(argv);
    process.stdout.write(text);
    process.exitCode = report.ok ? 0 : 1; // not process.exit(): a pipe write is async on Windows and would be cut
    return;
  }
  let root: string | null = null;
  const rootArg = parseValueFlag(argv, "--root", "--root にはディレクトリパスが必要です（例: --root /path/to/scope）。");
  const metricsPath = parseValueFlag(argv, "--metrics", "--metrics には JSONL の出力ファイルパスが必要です（例: --metrics ./mcp-calls.jsonl）。");
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
    if (metricsPath) process.stderr.write("slidecraft mcp: note — --metrics is ignored while forwarding (calls are logged by the host when it was started with SLIDECRAFT_MCP_METRICS).\n");
    process.stderr.write(forwardBanner(live.url));
    await runRelay(live);
    return;
  }
  await runSolo(root, metricsPath);
}

main().catch((e: unknown) => {
  process.stderr.write(`slidecraft mcp: fatal — ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
