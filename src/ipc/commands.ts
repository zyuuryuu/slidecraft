/**
 * commands.ts — File I/O that works BOTH as a Tauri desktop app (native open/save
 * dialogs + Rust fs commands) and in a plain browser (File API), chosen at runtime.
 *
 * The rest of the app calls the unified pick / save helpers and never branches on
 * platform — so the same codebase ships as a desktop installer and runs as a web
 * demo. Desktop is the standard product form; the browser path is dev/demo.
 */

// Tauri v2 injects __TAURI_INTERNALS__ into the webview; absent in a plain browser.
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function runningInTauri(): boolean {
  return isTauri;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export interface PickedText { name: string; content: string; }
export interface PickedBytes { name: string; bytes: Uint8Array; }

// Browser fallback: a transient <input type=file>. A cancelled picker simply never
// resolves (no change event), which reads as "user did nothing" — fine for our flows.
function browserPick(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

function browserDownload(data: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart]));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Open a text file (.md). Returns null if the user cancels. */
export async function pickTextFile(): Promise<PickedText | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }] });
    if (typeof path !== "string") return null;
    return { name: baseName(path), content: await invoke<string>("read_file", { path }) };
  }
  const file = await browserPick(".md,.markdown,.txt");
  return file ? { name: file.name, content: await file.text() } : null;
}

/** Open a binary file (e.g. a .pptx template). Returns null if the user cancels. */
export async function pickBinaryFile(extensions: string[], label: string): Promise<PickedBytes | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, filters: [{ name: label, extensions }] });
    if (typeof path !== "string") return null;
    const bytes = await invoke<number[]>("read_file_bytes", { path });
    return { name: baseName(path), bytes: new Uint8Array(bytes) };
  }
  const file = await browserPick(extensions.map((e) => "." + e).join(","));
  return file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null;
}

/** Save bytes via a native Save dialog (desktop) or a browser download. */
export async function saveBinaryFile(bytes: Uint8Array, defaultName: string, extensions: string[], label: string): Promise<boolean> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: defaultName, filters: [{ name: label, extensions }] });
    if (!path) return false;
    await invoke<void>("write_file", { path, content: Array.from(bytes) });
    return true;
  }
  browserDownload(bytes, defaultName);
  return true;
}

/** Save text (.md). */
export async function saveTextFile(text: string, defaultName: string): Promise<boolean> {
  return saveBinaryFile(new TextEncoder().encode(text), defaultName, ["md", "markdown", "txt"], "Markdown");
}
