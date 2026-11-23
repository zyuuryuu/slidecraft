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
 *
 * #727: the routing (keychain → localStorage fallback → legacy migration) is ONE implementation,
 * `secretBlobStore`, shared with the collab client grants (client-grants-store.ts — R8).
 */
import { runningInTauri } from "./commands";

/** localStorage bucket — also the legacy location we migrate away from. */
export const AI_CONFIG_STORAGE = "slidecraft_ai_config";

async function secretCmd<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export interface SecretBlobStore {
  save(value: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): Promise<void>;
}

/** One secret string under `account` in the OS keychain (desktop), else in localStorage[`localKey`]. A keychain
 *  failure (no backend) falls back to localStorage; a legacy localStorage copy is migrated up on load. */
export function secretBlobStore(account: string, localKey: string): SecretBlobStore {
  const readLocal = (): string | null => {
    try {
      return localStorage.getItem(localKey);
    } catch {
      return null;
    }
  };
  const save = async (value: string): Promise<void> => {
    if (runningInTauri()) {
      try {
        await secretCmd("secret_set", { account, value });
        localStorage.removeItem(localKey); // no stale plaintext copy once it's in the keychain
        return;
      } catch {
        /* no keychain backend → localStorage fallback below */
      }
    }
    try {
      localStorage.setItem(localKey, value);
    } catch {
      /* storage unavailable (private mode / quota) — simply isn't remembered */
    }
  };
  const load = async (): Promise<string | null> => {
    if (runningInTauri()) {
      try {
        const v = await secretCmd<string | null>("secret_get", { account });
        if (v != null) {
          localStorage.removeItem(localKey);
          return v;
        }
        const legacy = readLocal();
        if (legacy != null) {
          await save(legacy); // migrate the old plaintext blob into the keychain, then it's keychain-only
          return legacy;
        }
        return null;
      } catch {
        /* no keychain backend → localStorage fallback below */
      }
    }
    return readLocal();
  };
  const clear = async (): Promise<void> => {
    try {
      localStorage.removeItem(localKey);
    } catch {
      /* ignore */
    }
    if (runningInTauri()) {
      try {
        await secretCmd("secret_delete", { account });
      } catch {
        /* ignore */
      }
    }
  };
  return { save, load, clear };
}

const aiConfig = secretBlobStore("ai_config", AI_CONFIG_STORAGE);

/** Persist the serialized AI config: OS keychain on desktop (clearing any localStorage copy),
 *  else localStorage. A keychain failure (no backend) falls back to localStorage. */
export const saveAiConfig = (json: string): Promise<void> => aiConfig.save(json);

/** Load the serialized AI config. On desktop, reads the keychain; if empty, migrates a legacy
 *  localStorage blob up into the keychain and returns it. Returns null when nothing is stored. */
export const loadAiConfig = (): Promise<string | null> => aiConfig.load();

/** Forget the stored config in BOTH stores (used when "remember key" is turned off). */
export const clearAiConfig = (): Promise<void> => aiConfig.clear();
