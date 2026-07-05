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
  | "document-not-selected";

export class GuardError extends Error {
  constructor(message: string, public readonly code: GuardCode) {
    super(message);
    this.name = "GuardError";
    // Restore the prototype chain so `instanceof GuardError` holds after transpilation.
    Object.setPrototypeOf(this, GuardError.prototype);
  }
}
