/**
 * host-main.ts — the runnable entry for the collab listener sidecar (bundled by `build:host` and
 * spawned by the Tauri host in P2.3). Reads the port + handshake path from env, starts the
 * listener, and reaps cleanly on SIGINT/SIGTERM. Errors exit non-zero so the supervisor notices.
 */
import { createCollabHost } from "./host";
import { formatReadyLine } from "./host-handshake";

async function main(): Promise<void> {
  const port = Number(process.env.SLIDECRAFT_PORT ?? 5174);
  const hostJsonPath = process.env.SLIDECRAFT_HOST_JSON ?? null;
  const host = await createCollabHost({ port, hostJsonPath });
  // Machine-readable handshake on STDOUT for the Tauri supervisor (P2.3) to read {url,token}
  // directly off the child's pipe — no race against the host.json write. One tagged line.
  process.stdout.write(formatReadyLine({ url: host.url, token: host.token }) + "\n");
  process.stderr.write(`[slidecraft-host] listening ${host.url}\n`);

  let closing = false;
  const shutdown = (sig: string): void => {
    if (closing) return;
    closing = true;
    process.stderr.write(`[slidecraft-host] ${sig} → shutting down\n`);
    host.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  process.stderr.write(`[slidecraft-host] fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
