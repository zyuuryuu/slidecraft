/**
 * IPC Commands — Wrapper for Tauri invoke() calls.
 *
 * Provides typed wrappers for Rust backend commands.
 * Falls back to browser APIs when running outside Tauri (dev mode).
 *
 * Tauri dialog plugin integration is deferred to P6.
 */

// Detect if running inside Tauri
const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(cmd, args);
  }
  throw new Error(`Tauri not available: cannot invoke '${cmd}'`);
}

// ── File I/O ──

export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

export async function writeFile(path: string, content: Uint8Array): Promise<void> {
  return invoke<void>("write_file", { path, content: Array.from(content) });
}

// ── Browser-compatible file reading ──

export function readFileFromInput(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ── Browser-compatible file saving ──

export function downloadBlob(data: Uint8Array, filename: string): void {
  const blob = new Blob([data as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
