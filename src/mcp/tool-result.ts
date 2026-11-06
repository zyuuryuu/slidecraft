/**
 * tool-result.ts — the ONE MCP result envelope every tool shares (split out of server.ts for R1).
 * A GuardError is a MODELED precondition failure → the { ok:false, error, code } envelope
 * (isError:false, a normal result). Everything else is an unmodeled crash → isError:true. This is
 * THE choke point: run() and server.ts's mutate() funnel every throw through fail() (ADR-0015).
 */
import { GuardError, guardEnvelope } from "./guard-errors";

export interface ToolResult {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  isError?: boolean;
  [k: string]: unknown; // match the SDK's CallToolResult (passthrough _meta etc.)
}

export const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

export const fail = (e: unknown): ToolResult =>
  e instanceof GuardError
    ? ok(guardEnvelope(e))
    : { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };

export async function run(fn: () => unknown | Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}
