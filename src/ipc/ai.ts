/**
 * ai.ts — Provider-neutral entry point for AI Assist generation.
 *
 * "Claude" uses the native Anthropic SDK; every other provider goes through the
 * OpenAI-compatible Chat Completions path (a configurable base URL covers
 * OpenAI, OpenRouter, Groq, local Ollama/LM Studio, etc.).
 */

import { generateWithClaude } from "./claude";
import { generateWithOpenAICompat } from "./openai-compat";

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
}

export const PROVIDERS: ProviderPreset[] = [
  { id: "claude", label: "Claude (Anthropic)", native: true, baseURL: "", model: "claude-opus-4-8", keyRequired: true },
  { id: "openai", label: "OpenAI", native: false, baseURL: "https://api.openai.com/v1", model: "gpt-4o", keyRequired: true },
  { id: "openrouter", label: "OpenRouter", native: false, baseURL: "https://openrouter.ai/api/v1", model: "openai/gpt-4o", keyRequired: true },
  { id: "ollama", label: "Ollama (local)", native: false, baseURL: "http://localhost:11434/v1", model: "llama3.1", keyRequired: false },
  { id: "custom", label: "Custom (OpenAI-compatible)", native: false, baseURL: "", model: "", keyRequired: false },
];

export function providerPreset(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export interface AiRequest {
  provider: ProviderId;
  apiKey: string;
  baseURL: string;
  model: string;
  mode: "slides" | "diagram";
  userRequest: string;
  onText?: (fullText: string) => void;
  signal?: AbortSignal;
}

export function generateWithAI(req: AiRequest): Promise<string> {
  if (req.provider === "claude") {
    return generateWithClaude({
      apiKey: req.apiKey,
      model: req.model || undefined,
      mode: req.mode,
      userRequest: req.userRequest,
      onText: req.onText,
      signal: req.signal,
    });
  }
  return generateWithOpenAICompat({
    apiKey: req.apiKey,
    baseURL: req.baseURL,
    model: req.model,
    mode: req.mode,
    userRequest: req.userRequest,
    onText: req.onText,
    signal: req.signal,
  });
}
