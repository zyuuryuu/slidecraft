/**
 * cli.ts — `slidecraft serve`: the headless stdio MCP entry an upstream agent spawns.
 *
 * v1 is --no-fs (the default and only mode): the .scft / .pptx bytes flow as base64
 * over stdio, so the server reads/writes NO files — the trust boundary is just the agent
 * that spawned it (OS-user / inherited stdio). A scoped --root mode is reserved for later.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSession } from "./session";
import { buildServer } from "./server";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--root")) {
    process.stderr.write(
      "slidecraft serve: --root（scoped fs）は次バージョンで対応予定です。v1 は --no-fs（base64 over stdio）のみ。\n",
    );
    process.exit(2);
  }
  const session = createSession(null); // --no-fs: no filesystem; bytes flow as base64
  const server = buildServer(session);
  await server.connect(new StdioServerTransport());
  process.stderr.write("slidecraft serve: ready (stdio MCP, --no-fs / base64)\n");
}

main().catch((e: unknown) => {
  process.stderr.write(`slidecraft serve: fatal — ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
