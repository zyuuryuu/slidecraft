/**
 * cli.ts — `slidecraft serve` / `slidecraft mcp`: the single client-facing stdio entry an upstream
 * agent spawns (ADR-0033 D2: an "adaptive front"). It always starts SOLO — a `createSoloHostContext`
 * control plane wraps a fresh Session, with commitMutation/undo pinned to that one doc — and, in front of
 * every tool call, RE-DISCOVERS a GUI-hosted collab listener through the `host.json` the Tauri supervisor
 * writes (`src-tauri/src/collab.rs:120`; #728 / ADR-0040 D2, which supersedes "decide once at startup"):
 *
 *  - solo without a deck + a LIVE host → the adapter connects to the host itself (replaying the AI's
 *    clientInfo, applying for the human's approval — ADR-0040 D3) and FORWARDS from that call on. Deck state
 *    and undo history then live ONLY in the host's DocRegistry — forward never becomes a second control plane.
 *  - solo WITH a deck → stays solo; the result's `note` says to save and close_document first (never-silent:
 *    a solo deck is never carried over or dropped).
 *  - forwarding and the host stops answering → re-read host.json: a new host → reconnect; none → solo, `note`.
 * The state machine is adaptive-front.ts (pure decisions: front-decide.ts).
 *
 * The default mode is --no-fs: the .scft / .pptx bytes flow as base64 over stdio, so the server
 * reads/writes NO deck files — the trust boundary is just the agent that spawned it (OS-user / inherited
 * stdio; solo carries no token — that's HTTP-only, host-security.ts). Two DELIBERATE, narrow exceptions
 * to --no-fs's "no filesystem" posture, neither touching deck content (ADR-0007/ADR-0033/ADR-0040):
 * reading the fixed, 0600 host.json to find a host, and reading/writing this AI app's own 0600 credential
 * file next to it (client-credentials.ts — the client id and the per-pair secret of ADR-0040 D3).
 *
 * ADR-0035 stage 1 (output side, #299): `--root <dir>` opts into a SCOPED fs mode — export_pptx /
 * save_project then write under that one directory and return a path instead of base64
 * (fs-scope.ts). --no-fs (base64) stays the byte-identical default when --root is absent. Input-side
 * fs (open_project/new_project) and the loopback-binary data plane remain follow-up work.
 */
import { resolve as resolvePath } from "path";
import { createSession } from "./session";
import { buildServer } from "./server";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSoloHostContext, openDeckDocId } from "./host-core";
import { resolveHostJsonPath, pingAlive } from "./host-discovery";
import { readHostJson } from "./host-json";
import { resolveScopeRoot } from "./fs-scope";
import { createProbeAwareStdio } from "./discover-probe";
import { createFileMetricsRecorder } from "./metrics-sink";
import { soloReadyBanner } from "./cli-banner";
import { runDoctor } from "./doctor";
import { AdaptiveFront } from "./adaptive-front";
import { HostWatch } from "./front-decide";
import { attachHost } from "./host-attach";
import { CredentialFile, credentialPath } from "./client-credentials";

async function runAdaptive(root: string | null, metricsPath: string | undefined): Promise<void> {
  const session = createSession(root); // root===null: --no-fs, bytes flow as base64; else scoped fs (ADR-0035)
  const host = createSoloHostContext(session); // solo control plane: one doc, sole-doc resolution, no token
  // #512: --metrics <path> opts into a LOCAL JSONL call log (no egress — ADR-0016). Absent = OFF:
  // no recorder, handlers unwrapped, nothing written anywhere.
  const metrics = metricsPath ? createFileMetricsRecorder(resolvePath(metricsPath)) : undefined;
  const server = buildServer(session, { host, registerResources: true, metrics });
  // The solo server stays alive the whole session (the AI's initialize is always its); the front routes each
  // message to it or — after a switch — to the GUI host. In memory: same JSON-RPC objects, same bytes on stdout.
  const [soloFront, soloServerEnd] = InMemoryTransport.createLinkedPair();
  await server.connect(soloServerEnd);
  const hostJsonPath = resolveHostJsonPath();
  let told = false;
  const front = new AdaptiveFront({
    // #518: the 2026-07-28 `server/discover` probe is answered in front of everything (discover-probe.ts).
    local: createProbeAwareStdio(),
    solo: soloFront,
    soloDeckDocId: () => openDeckDocId(host.registry),
    watch: new HostWatch(() => readHostJson(hostJsonPath), (h) => pingAlive(h.url, h.token, 1500)),
    attach: (h, init) => {
      // Forwarding hands the session to the GUI host's own control plane — this process writes nothing, so a
      // --root scope / --metrics log has no effect there (never-silently dropped: told once, not hidden).
      if (!told) {
        told = true;
        if (root) process.stderr.write("slidecraft mcp: note — --root is ignored while forwarding to a live GUI host (deck state lives in the host process).\n");
        if (metricsPath) process.stderr.write("slidecraft mcp: note — --metrics is ignored while forwarding (calls are logged by the host when it was started with SLIDECRAFT_MCP_METRICS).\n");
      }
      return attachHost(h, init, new CredentialFile(credentialPath(hostJsonPath, init.clientInfo.name)));
    },
    log: (line) => process.stderr.write(line),
  });
  await front.start();
  // The client stops a stdio server by closing stdin; the SDK's stdio transport does not report that, so the
  // front is closed here (it ends the host connection, letting the process exit while forwarding too).
  process.stdin.on("end", () => void front.close());
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

  await runAdaptive(root, metricsPath);
}

main().catch((e: unknown) => {
  process.stderr.write(`slidecraft mcp: fatal — ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
