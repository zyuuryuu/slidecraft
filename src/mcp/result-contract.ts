/**
 * result-contract.ts — client-side mirror of the success/failure contract documented in
 * docs/mcp-server.md「エラー契約」: success = neither `isError:true` (unmodeled crash) nor a
 * payload carrying `ok:false` (domain/guard rejection). Read tools (and the `deck://…` resource
 * mirrors) return their payload as-is with no `ok` key at all — Issue #246 deliberately does NOT
 * wrap them in `{ok:true, ...}`, since that would break the tool↔resource mirror equality
 * (ADR-0008). `isOk` accepts either a raw payload object or the full MCP CallToolResult shape
 * (`{isError?, content}`) so callers can pass whichever they have on hand.
 */
interface CallToolResultLike {
  isError?: boolean;
  content?: { type?: string; text?: string }[];
}

function payloadOk(payload: unknown): boolean {
  return !(payload && typeof payload === "object" && (payload as { ok?: unknown }).ok === false);
}

export function isOk(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  const r = result as CallToolResultLike & { ok?: unknown };
  if (r.isError) return false;
  if (!payloadOk(r)) return false;
  if (Array.isArray(r.content)) {
    const text = r.content.find((c) => c && c.type === "text")?.text;
    if (typeof text === "string") {
      try {
        if (!payloadOk(JSON.parse(text))) return false;
      } catch {
        // non-JSON text content (e.g. a crash message) is covered by isError above
      }
    }
  }
  return true;
}
