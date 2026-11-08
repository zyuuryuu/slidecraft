/**
 * Pure view logic for the 協働 panel's 接続テスト (#517 子 4) and Claude Desktop `.mcpb` download (#517 子 3).
 * No DOM / Tauri — results come in as plain data (ipc/mcp-doctor.ts, ipc/mcpb-asset.ts); the components only
 * render these decisions. Every outcome maps to a message (never-silent).
 */
import type { DoctorRunResult } from "../ipc/mcp-doctor";
import type { McpbDownload } from "../ipc/mcpb-asset";

type Params = { code?: string; error?: string; tag?: string; name?: string };

export interface DoctorView {
  /** ok = a client can connect; ng = the doctor ran and something failed; unavailable = it could not run. */
  tone: "ok" | "ng" | "unavailable";
  message: { key: "doctorOk" | "doctorNoReport" | "doctorNg" | "doctorTimedOut" | "doctorSpawnFailed" | "doctorIpcError" | "doctorBrowser"; params: Params };
  /** The doctor's one-screen report, verbatim. */
  report: string | null;
  /** The doctor process's stderr, shown when the run was not ok. */
  stderr: string | null;
}

const orNull = (s: string) => (s.trim() ? s : null);

export function doctorView(r: DoctorRunResult): DoctorView {
  switch (r.kind) {
    case "ran": {
      const report = orNull(r.stdout);
      const stderr = orNull(r.stderr);
      if (r.timedOut) return { tone: "ng", message: { key: "doctorTimedOut", params: {} }, report, stderr };
      if (r.exitCode !== 0) return { tone: "ng", message: { key: "doctorNg", params: { code: r.exitCode === null ? "—" : String(r.exitCode) } }, report, stderr };
      // Exit 0 without a report: a cli.cjs from before --doctor ignores the flag, serves, and exits on stdin EOF.
      if (!report) return { tone: "ng", message: { key: "doctorNoReport", params: {} }, report: null, stderr };
      return { tone: "ok", message: { key: "doctorOk", params: {} }, report, stderr: null };
    }
    case "spawnFailed":
      return { tone: "unavailable", message: { key: "doctorSpawnFailed", params: { error: r.error } }, report: null, stderr: null };
    case "error":
      return { tone: "unavailable", message: { key: "doctorIpcError", params: { error: r.error } }, report: null, stderr: null };
    case "browser":
      return { tone: "unavailable", message: { key: "doctorBrowser", params: {} }, report: null, stderr: null };
  }
}

export interface McpbView {
  message: { key: "mcpbLoading" | "mcpbBrowser" | "mcpbDownload" | "mcpbMissing" | "mcpbUnsupported" | "mcpbError"; params: Params };
  /** Set only when there is a bundle to download. */
  url: string | null;
}

/** `null` = lookup still running; `{kind:"browser"}` = no desktop install to pick an OS for. */
export function mcpbView(d: McpbDownload | { kind: "browser" } | null): McpbView {
  if (d === null) return { message: { key: "mcpbLoading", params: {} }, url: null };
  switch (d.kind) {
    case "browser":
      return { message: { key: "mcpbBrowser", params: {} }, url: null };
    case "available":
      return { message: { key: "mcpbDownload", params: { tag: d.tag, name: d.name } }, url: d.url };
    case "missing":
      return { message: { key: "mcpbMissing", params: { tag: d.tag, name: d.name } }, url: null };
    case "unsupported":
      return { message: { key: "mcpbUnsupported", params: {} }, url: null };
    case "error":
      return { message: { key: "mcpbError", params: { error: d.error } }, url: null };
  }
}
