/**
 * guard-errors.ts — GuardError marks a MODELED precondition failure (out-of-range index, no project
 * open, no document selected) as distinct from an unmodeled crash. The MCP server's fail() turns a
 * GuardError into a { ok:false, error, code } envelope (isError:false), so isError:true is reserved
 * for genuine crashes only — the error-contract unification (ADR-0015). Direct engine/session callers
 * still see a normal throw (GuardError extends Error), so unit tests asserting .toThrow keep working;
 * only the MCP tool envelope changes.
 */
export type GuardCode =
  | "project-not-opened"
  | "index-out-of-range"
  | "host-mode-required"
  | "document-not-selected"
  | "template-registry-unavailable" // list/use_template: no GUI registry injected (→ create_template)
  | "unknown-template" // use_template: the id isn't in the registry (→ list_templates)
  // get_slide_image (#109) — screenshots are OPTIONAL; each failure guides instead of blanking:
  | "browser-not-found" // no system Chrome/Edge and no SLIDECRAFT_BROWSER (→ install / point env)
  | "browser-launch-failed" // the resolved browser binary would not start
  | "raster-timeout" // the browser hung past the deadline (killed)
  | "raster-failed"; // the browser ran but produced no screenshot (stderr excerpt in message)

export class GuardError extends Error {
  // Explicit field (not a `public readonly code` parameter property): parameter properties emit
  // runtime code, which erasableSyntaxOnly (tsconfig.app/mcp) forbids (TS1294).
  readonly code: GuardCode;
  constructor(message: string, code: GuardCode) {
    super(message);
    this.code = code;
    this.name = "GuardError";
    // Restore the prototype chain so `instanceof GuardError` holds after transpilation.
    Object.setPrototypeOf(this, GuardError.prototype);
  }
}
