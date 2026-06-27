/**
 * ai.ts — Provider-neutral entry point for AI Assist generation.
 *
 * "Claude" uses the native Anthropic SDK; every other provider goes through the
 * OpenAI-compatible Chat Completions path (a configurable base URL covers
 * OpenAI, OpenRouter, Groq, local Ollama/LM Studio, etc.).
 */

import { generateWithClaude } from "./claude";
import { generateWithOpenAICompat } from "./openai-compat";
import { appFetch } from "./app-fetch";
import { systemPromptForMode } from "../engine/llm-prompts";

export type ProviderId = "claude" | "openai" | "openrouter" | "ollama" | "custom";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  /** Claude uses the native Anthropic SDK; the rest use OpenAI-compatible HTTP. */
  native: boolean;
  baseURL: string;
  model: string;
  /** Whether an API key is required (local runtimes often don't need one). */
  keyRequired: boolean;
  /** Default "is this a local runtime" hint. For non-native providers the ACTUAL
   *  gate is the runtime baseURL host (a "custom" endpoint is free-text, and Ollama's
   *  URL can be repointed), so isLocalTarget() checks the URL — this flag only drives
   *  the native case (Claude is cloud-only) + the default UI grouping. */
  local: boolean;
}

export const PROVIDERS: ProviderPreset[] = [
  { id: "claude", label: "Claude (Anthropic)", native: true, baseURL: "", model: "claude-opus-4-8", keyRequired: true, local: false },
  { id: "openai", label: "OpenAI", native: false, baseURL: "https://api.openai.com/v1", model: "gpt-4o", keyRequired: true, local: false },
  { id: "openrouter", label: "OpenRouter", native: false, baseURL: "https://openrouter.ai/api/v1", model: "openai/gpt-4o", keyRequired: true, local: false },
  { id: "ollama", label: "Ollama (local)", native: false, baseURL: "http://localhost:11434/v1", model: "llama3.1", keyRequired: false, local: true },
  { id: "custom", label: "Custom (OpenAI-compatible)", native: false, baseURL: "", model: "", keyRequired: false, local: false },
];

export function providerPreset(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/** True when a base URL points at the local machine / LAN (loopback, *.localhost, or
 *  an RFC1918 private range) — i.e. NOT a cloud endpoint. Free-text "custom" URLs make
 *  the provider id insufficient, so egress control checks the host here. */
export function isLocalBaseURL(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  let host: string;
  try {
    host = new URL(raw.includes("://") ? raw : `http://${raw}`).hostname;
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, "").toLowerCase(); // strip IPv6 brackets
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 169 && b === 254) return true; // link-local
  }
  return false;
}

/** Whether sending to this provider+endpoint stays on the local machine/LAN. Native
 *  Claude is always cloud; everything else is decided by the actual baseURL host. */
export function isLocalTarget(provider: ProviderId, baseURL: string): boolean {
  const preset = providerPreset(provider);
  return preset.native ? preset.local : isLocalBaseURL(baseURL);
}

export interface AiRequest {
  provider: ProviderId;
  apiKey: string;
  baseURL: string;
  model: string;
  mode: "slides" | "slide" | "diagram" | "diagram-edit";
  userRequest: string;
  onText?: (fullText: string) => void;
  signal?: AbortSignal;
  /** Local-model-only mode: hard-block any non-local target. */
  localOnly?: boolean;
}

export function generateWithAI(req: AiRequest): Promise<string> {
  // Local-model-only egress block — enforced HERE because this is the single last
  // choke every generation path routes through (generate / submit / submitAndWait),
  // so a UI-level guard that submit/submitAndWait skip cannot leak the deck to a cloud
  // endpoint. Thrown before any network call.
  if (req.localOnly && !isLocalTarget(req.provider, req.baseURL)) {
    return Promise.reject(
      new Error(
        "ローカルモデル限定モードが有効です — クラウドのプロバイダ/エンドポイントへの送信はブロックされました。",
      ),
    );
  }
  // Slides go through the DeckPlan harness (small constrained JSON the engine
  // turns into correct layouts); "slide" edits one slide (token-cheap);
  // "diagram" generates / "diagram-edit" revises a DiagramSpec.
  const today = new Date().toISOString().slice(0, 10);
  const system = systemPromptForMode(req.mode, today);

  if (req.provider === "claude") {
    return generateWithClaude({
      apiKey: req.apiKey,
      model: req.model || undefined,
      system,
      userRequest: req.userRequest,
      onText: req.onText,
      signal: req.signal,
    });
  }
  return generateWithOpenAICompat({
    apiKey: req.apiKey,
    baseURL: req.baseURL,
    model: req.model,
    system,
    userRequest: req.userRequest,
    onText: req.onText,
    signal: req.signal,
  });
}

// Known Claude models (no public list endpoint via the SDK path).
const CLAUDE_MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"];

/**
 * List the models the provider actually has available, so the UI can offer a
 * dropdown of installed models (e.g. local Ollama tags) instead of free text.
 * Uses the OpenAI-compatible `GET {baseURL}/models` for non-native providers.
 */
export async function listProviderModels(
  provider: ProviderId,
  baseURL: string,
  apiKey: string,
): Promise<string[]> {
  if (provider === "claude") return CLAUDE_MODELS;
  const base = baseURL.trim().replace(/\/+$/, "");
  if (!base) throw new Error("Base URL is required.");
  const res = await appFetch(`${base}/models`, {
    headers: apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{ id?: string; name?: string }>;
    models?: Array<{ id?: string; name?: string }>;
  };
  const rows = json.data ?? json.models ?? [];
  const ids = rows.map((m) => m.id ?? m.name).filter((x): x is string => !!x);
  return [...new Set(ids)].sort();
}
