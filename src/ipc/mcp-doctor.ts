/**
 * mcp-doctor.ts — IPC for the 協働 panel's 接続テスト (#517 子 4). One Rust command, `mcp_doctor`, that runs the
 * bundled server's own `--doctor` (src/mcp/doctor.ts — the diagnosis lives only there, R8) and returns its exit
 * code + stdout (the one-screen report) + stderr. The webview passes no strings. Dual-mode like
 * claude-register.ts: `browser` outside Tauri (nothing runs); an IPC failure is returned as `error`, not swallowed.
 */
import { runningInTauri } from "./commands";

/** Mirrors Rust `DoctorOutcome` (serde tag `kind`). */
export type DoctorOutcome =
  | { kind: "ran"; program: string; args: string[]; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }
  | { kind: "spawnFailed"; program: string; args: string[]; error: string };

export type DoctorRunResult = DoctorOutcome | { kind: "browser" } | { kind: "error"; error: string };

export async function runMcpDoctor(): Promise<DoctorRunResult> {
  if (!runningInTauri()) return { kind: "browser" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<DoctorOutcome>("mcp_doctor");
  } catch (e) {
    return { kind: "error", error: e instanceof Error ? e.message : String(e) };
  }
}
