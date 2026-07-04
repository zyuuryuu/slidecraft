/**
 * egress-consent.ts — user consent gate for sending a BYOK request (which carries the API key)
 * to a NON-preset, NON-local endpoint. Preset cloud hosts (Anthropic/OpenAI/OpenRouter) and
 * local/loopback/LAN targets never prompt; a free-text "custom" cloud host must be trusted by the
 * user once, then it's remembered. A UX defense against being socially-engineered into a malicious
 * baseURL that would exfiltrate the key (ADR-0016 F1). NOT a hard boundary — the http capability is
 * unchanged, so a compromised webview can bypass this; it stops the human-tricked case. Pairs with
 * assertValidBaseURL (https-only) in ai.ts.
 */
import { isLocalBaseURL } from "./ai";
import { confirmDialog } from "./commands";

/** Cloud hosts the app ships as presets — always allowed, never prompt. */
const PRESET_HOSTS = new Set(["api.anthropic.com", "api.openai.com", "openrouter.ai"]);

const TRUSTED_STORAGE = "slidecraft_trusted_endpoints";

/** The lowercased hostname of a base URL (a bare host is read as http), or null if unparseable. */
export function hostOf(baseURL: string): string | null {
  const raw = baseURL.trim();
  if (!raw) return null;
  try {
    return new URL(raw.includes("://") ? raw : `http://${raw}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isPresetHost(host: string): boolean {
  return PRESET_HOSTS.has(host.toLowerCase());
}

/** Whether sending to this base URL needs a fresh user OK: a non-local host that is neither a
 *  shipped preset nor in the already-trusted list. Pure — the caller passes the current list in. */
export function needsEgressConsent(baseURL: string, trusted: readonly string[]): boolean {
  if (isLocalBaseURL(baseURL)) return false; // local/loopback/LAN never leaves the machine
  const host = hostOf(baseURL);
  if (!host) return false; // unparseable → assertValidBaseURL rejects it separately
  if (isPresetHost(host)) return false;
  return !trusted.includes(host);
}

// ── localStorage-backed trusted list (webview/browser only; guarded for the node test env) ──

export function loadTrustedHosts(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const arr = JSON.parse(localStorage.getItem(TRUSTED_STORAGE) ?? "[]");
    return Array.isArray(arr) ? arr.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}

export function addTrustedHost(host: string): void {
  if (typeof localStorage === "undefined") return;
  const set = new Set(loadTrustedHosts());
  set.add(host.toLowerCase());
  localStorage.setItem(TRUSTED_STORAGE, JSON.stringify([...set]));
}

/** If the target needs consent and isn't trusted, prompt the user (native dialog / window.confirm):
 *  throw if declined, else remember the host. No-op for preset/local hosts. Call before the API key
 *  is sent (ADR-0016 F1). Kept here (not in the hook) so the already-large useAiGeneration stays lean. */
export async function ensureEgressConsent(baseURL: string): Promise<void> {
  if (!needsEgressConsent(baseURL, loadTrustedHosts())) return;
  const host = hostOf(baseURL)!;
  const approved = await confirmDialog(
    `AI リクエスト（API キーを含む）を次の外部エンドポイントに送信しようとしています:\n\n  ${host}\n\nこの宛先を信頼して送信しますか？（以後このマシンでは確認しません）`,
    "外部エンドポイントの確認",
  );
  if (!approved) throw new Error(`送信先 ${host} が未承認のため中止しました。`);
  addTrustedHost(host);
}
