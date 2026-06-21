/**
 * app-fetch.ts — A `fetch` that routes through Rust (tauri-plugin-http) when
 * running as a desktop app, falling back to the webview's native fetch in the
 * browser. A drop-in for the global fetch (passed to the AI SDKs + model listing).
 *
 * Why: the production Tauri build's webview origin is `tauri://localhost`, which
 * a local Ollama (localhost:11434) and some cloud APIs reject via CORS. Requests
 * issued from Rust have no browser origin, so they aren't CORS-blocked — local and
 * cloud AI both work in the shipped app. In dev/browser, the native fetch is fine.
 */
import { runningInTauri } from "./commands";

let tauriFetch: typeof globalThis.fetch | null = null;

async function getTauriFetch(): Promise<typeof globalThis.fetch> {
  if (!tauriFetch) {
    const mod = await import("@tauri-apps/plugin-http");
    tauriFetch = mod.fetch as unknown as typeof globalThis.fetch;
  }
  return tauriFetch;
}

export const appFetch: typeof globalThis.fetch = async (input, init) => {
  if (runningInTauri()) {
    const f = await getTauriFetch();
    return f(input, init);
  }
  return globalThis.fetch(input, init);
};
