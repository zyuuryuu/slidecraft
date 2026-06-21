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
import { deckPlanSystemPrompt, slideMarkdownEditPrompt } from "../engine/deck-plan";
import { diagramSystemPrompt, diagramEditSystemPrompt } from "../engine/llm-prompts";

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
  mode: "slides" | "slide" | "diagram" | "diagram-edit";
  userRequest: string;
  onText?: (fullText: string) => void;
  signal?: AbortSignal;
}

export function generateWithAI(req: AiRequest): Promise<string> {
  // Slides go through the DeckPlan harness (small constrained JSON the engine
  // turns into correct layouts); "slide" edits one slide (token-cheap);
  // "diagram" generates / "diagram-edit" revises a DiagramSpec.
  const today = new Date().toISOString().slice(0, 10);
  const system =
    req.mode === "slides"
      ? deckPlanSystemPrompt(today)
      : req.mode === "slide"
        ? slideMarkdownEditPrompt()
        : req.mode === "diagram-edit"
          ? diagramEditSystemPrompt()
          : diagramSystemPrompt();

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
