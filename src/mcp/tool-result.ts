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

/** Attach a never-silent `note` to a result (#727: a call admitted although the GUI's deck seed failed). A JSON
 *  object result gains a `note` field (joined with an existing one); anything else gets the note appended as
 *  its own text block — the payload itself is never altered. */
export function withNote(r: ToolResult, note: string): ToolResult {
  const first = r.content[0];
  if (!r.isError && first?.type === "text") {
    try {
      const v = JSON.parse(first.text) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const prev = (v as { note?: unknown }).note;
        const merged = { ...(v as object), note: typeof prev === "string" && prev ? `${prev}\n${note}` : note };
        return { ...r, content: [{ type: "text", text: JSON.stringify(merged, null, 2) }, ...r.content.slice(1)] };
      }
    } catch {
      /* not JSON — fall through */
    }
  }
  return { ...r, content: [...r.content, { type: "text", text: JSON.stringify({ note }) }] };
}
