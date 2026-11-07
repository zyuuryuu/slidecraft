/**
 * Pure view logic for the one-click "Claude Code に登録" (#530). No DOM / Tauri — the plan and the run result
 * come in as plain data (ipc/claude-register.ts). Decides what the panel shows and whether it falls back to
 * copying the command; the component only renders these decisions.
 */
import type { RegisterPlanLookup, RegisterRunResult } from "../ipc/claude-register";
import { formatArgv, type InstallOs } from "./collab-panel-snippets";

/** The full command line shown in the confirm dialog: the real `claude` path + every argument, quoted per OS. */
export function formatInvocation(os: InstallOs, program: string, args: readonly string[]): string {
  return formatArgv(os, [program, ...args]);
}

/** i18n key under `collabPanel` + its interpolation params (all strings). */
export interface ViewMessage {
  key: "registerRanOk" | "registerRanFailed" | "registerTimedOut" | "registerClaudeNotFound" | "registerSpawnFailed" | "registerIpcError";
  params: { code?: string; searched?: string; error?: string };
}

export interface OutcomeView {
  /** ok = registered; failed = claude ran and failed; fallback = nothing ran. */
  tone: "ok" | "failed" | "fallback";
  /** Copy the command so the user can run it in a terminal instead (the pre-#530 path). */
  copyFallback: boolean;
  /** Why — `null` only for the browser build, where copying IS the feature. */
  message: ViewMessage | null;
  /** The raw result of a run (exit code + both streams), shown verbatim. */
  details: { exitCode: string; stdout: string; stderr: string } | null;
}

const code = (c: number | null) => (c === null ? "—" : String(c));

export function outcomeView(r: RegisterRunResult): OutcomeView {
  switch (r.kind) {
    case "ran": {
      const details = { exitCode: code(r.exitCode), stdout: r.stdout, stderr: r.stderr };
      if (r.timedOut) return { tone: "failed", copyFallback: true, message: { key: "registerTimedOut", params: {} }, details };
      if (r.exitCode === 0) return { tone: "ok", copyFallback: false, message: { key: "registerRanOk", params: { code: "0" } }, details };
      return { tone: "failed", copyFallback: true, message: { key: "registerRanFailed", params: { code: code(r.exitCode) } }, details };
    }
    case "claudeNotFound":
      return { tone: "fallback", copyFallback: true, message: { key: "registerClaudeNotFound", params: { searched: r.searched.join(", ") } }, details: null };
    case "spawnFailed":
      return { tone: "fallback", copyFallback: true, message: { key: "registerSpawnFailed", params: { error: r.error } }, details: null };
    case "error":
      return { tone: "fallback", copyFallback: true, message: { key: "registerIpcError", params: { error: r.error } }, details: null };
    case "browser":
      return { tone: "fallback", copyFallback: true, message: null, details: null };
  }
}

/** What a click does: only a `ready` plan opens the confirm dialog; anything else copies (nothing runs). */
export type PlanAction = { kind: "confirm"; command: string } | { kind: "copy"; view: OutcomeView };

export function planAction(plan: RegisterPlanLookup, os: InstallOs): PlanAction {
  return plan.kind === "ready"
    ? { kind: "confirm", command: formatInvocation(os, plan.program, plan.args) }
    : { kind: "copy", view: outcomeView(plan) };
}
