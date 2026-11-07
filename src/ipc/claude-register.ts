/**
 * claude-register.ts — IPC for the one-click "Claude Code に登録" (#530). Two Rust commands, NEITHER takes a
 * string from the webview (the arguments are built in Rust from the install facts — no arbitrary-exec port):
 *  - `claude_register_plan`: read-only — the exact command a run would execute, or why there is none.
 *  - `register_claude_code`: runs `claude mcp add --scope user slidecraft -- …`; call ONLY after the user
 *    confirmed the plan. Returns the exit code + stdout/stderr (never-silent).
 * Dual-mode like mcp-install.ts: in a plain browser both report `browser` and nothing runs; an IPC failure is
 * returned as `error` (reason kept), not swallowed.
 */
import { runningInTauri } from "./commands";

/** Mirrors Rust `RegisterPlan` (serde tag `kind`). */
export type RegisterPlan =
  | { kind: "ready"; program: string; args: string[] }
  | { kind: "claudeNotFound"; searched: string[] };

/** Mirrors Rust `RegisterOutcome` (serde tag `kind`). */
export type RegisterOutcome =
  | { kind: "ran"; program: string; args: string[]; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }
  | { kind: "claudeNotFound"; searched: string[] }
  | { kind: "spawnFailed"; program: string; args: string[]; error: string };

/** Not desktop, or the Rust command itself failed (message kept). */
export type RegisterUnavailable = { kind: "browser" } | { kind: "error"; error: string };

export type RegisterPlanLookup = RegisterPlan | RegisterUnavailable;
export type RegisterRunResult = RegisterOutcome | RegisterUnavailable;

async function call<T>(cmd: string): Promise<T | RegisterUnavailable> {
  if (!runningInTauri()) return { kind: "browser" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd);
  } catch (e) {
    return { kind: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export function planClaudeRegister(): Promise<RegisterPlanLookup> {
  return call<RegisterPlan>("claude_register_plan");
}

export function runClaudeRegister(): Promise<RegisterRunResult> {
  return call<RegisterOutcome>("register_claude_code");
}
