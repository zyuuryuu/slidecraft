/**
 * key-store.ts — at-rest storage for the AI config blob (which contains the BYOK API key(s)).
 * ADR-0016 F3.
 *
 * Prefers the OS keychain (Rust `secret_store` commands: Windows Credential Manager / macOS
 * Keychain / Linux Secret Service) so the key is NOT sitting in JS-reachable `localStorage`.
 * Falls back to `localStorage` when no keychain backend is present (the browser/demo build, or a
 * Linux box without a Secret Service) — status quo, no regression, and a strict upgrade wherever a
 * keychain exists. A legacy localStorage blob is migrated up into the keychain on first load.
 *
 * NOTE: this closes the plaintext-at-rest bucket + the trivial `localStorage.getItem` XSS-read.
 * It does NOT fully decouple key-theft from a webview compromise (the SDK still builds the request
 * in JS, so the key is in the JS heap in use) — that needs the Rust egress proxy (ADR-0016 F1').
 */
import { runningInTauri } from "./commands";

/** localStorage bucket — also the legacy location we migrate away from. */
export const AI_CONFIG_STORAGE = "slidecraft_ai_config";
/** keychain account name under the app's service. */
const KEYCHAIN_ACCOUNT = "ai_config";

async function secretCmd<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Persist the serialized AI config: OS keychain on desktop (clearing any localStorage copy),
 *  else localStorage. A keychain failure (no backend) falls back to localStorage. */
export async function saveAiConfig(json: string): Promise<void> {
  if (runningInTauri()) {
    try {
      await secretCmd("secret_set", { account: KEYCHAIN_ACCOUNT, value: json });
      localStorage.removeItem(AI_CONFIG_STORAGE); // no stale plaintext copy once it's in the keychain
      return;
    } catch {
      /* no keychain backend → localStorage fallback below */
    }
  }
  try {
    localStorage.setItem(AI_CONFIG_STORAGE, json);
  } catch {
    /* storage unavailable (private mode / quota) — key simply isn't remembered */
  }
}

/** Load the serialized AI config. On desktop, reads the keychain; if empty, migrates a legacy
 *  localStorage blob up into the keychain and returns it. Returns null when nothing is stored. */
export async function loadAiConfig(): Promise<string | null> {
  if (runningInTauri()) {
    try {
      const v = await secretCmd<string | null>("secret_get", { account: KEYCHAIN_ACCOUNT });
      if (v != null) {
        localStorage.removeItem(AI_CONFIG_STORAGE);
        return v;
      }
      const legacy = readLocal();
      if (legacy != null) {
        await saveAiConfig(legacy); // migrate the old plaintext blob into the keychain, then it's keychain-only
        return legacy;
      }
      return null;
    } catch {
      /* no keychain backend → localStorage fallback below */
    }
  }
  return readLocal();
}

/** Forget the stored config in BOTH stores (used when "remember key" is turned off). */
export async function clearAiConfig(): Promise<void> {
  try {
    localStorage.removeItem(AI_CONFIG_STORAGE);
  } catch {
    /* ignore */
  }
  if (runningInTauri()) {
    try {
      await secretCmd("secret_delete", { account: KEYCHAIN_ACCOUNT });
    } catch {
      /* ignore */
    }
  }
}

function readLocal(): string | null {
  try {
    return localStorage.getItem(AI_CONFIG_STORAGE);
  } catch {
    return null;
  }
}
