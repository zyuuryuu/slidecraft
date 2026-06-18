/**
 * openai-compat.ts — Generate via any OpenAI-compatible Chat Completions API.
 *
 * Covers OpenAI, OpenRouter, Groq, Together, Mistral, DeepSeek, and local
 * runtimes (Ollama, LM Studio, vLLM) — anything exposing /v1/chat/completions.
 * BYOK, runs in the browser / Tauri WebView. Lives in ipc/ (network layer).
 *
 * NOTE: this is a deliberately non-Anthropic provider module. Keep Anthropic
 * code in claude.ts; do not mix the two SDKs in one file.
 */

import OpenAI from "openai";

export interface OpenAICompatOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  system: string;
  userRequest: string;
  onText?: (fullText: string) => void;
  signal?: AbortSignal;
}

export async function generateWithOpenAICompat(opts: OpenAICompatOptions): Promise<string> {
  if (!opts.baseURL.trim()) throw new Error("Base URL is required.");
  if (!opts.model.trim()) throw new Error("Model name is required.");

  const client = new OpenAI({
    // Some local runtimes ignore the key but the SDK requires a non-empty value.
    apiKey: opts.apiKey.trim() || "not-needed",
    baseURL: opts.baseURL.trim(),
    dangerouslyAllowBrowser: true,
  });

  try {
    const stream = await client.chat.completions.create(
      {
        model: opts.model.trim(),
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.userRequest },
        ],
        stream: true,
      },
      { signal: opts.signal },
    );

    let full = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        full += delta;
        opts.onText?.(full);
      }
    }
    return full.trim();
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

function friendlyError(e: unknown): string {
  if (e instanceof OpenAI.APIUserAbortError) {
    return "Generation cancelled.";
  }
  if (e instanceof OpenAI.AuthenticationError) {
    return "Authentication failed — check your API key.";
  }
  if (e instanceof OpenAI.PermissionDeniedError) {
    return "Your key lacks access to this model.";
  }
  if (e instanceof OpenAI.NotFoundError) {
    return "Model or endpoint not found — check the base URL and model name.";
  }
  if (e instanceof OpenAI.RateLimitError) {
    return "Rate limited — wait a moment and try again.";
  }
  if (e instanceof OpenAI.APIConnectionError) {
    return "Could not reach the endpoint — check the base URL, that the server is running, and that it allows browser (CORS) requests.";
  }
  if (e instanceof OpenAI.APIError) {
    return `API error (${e.status ?? "?"}): ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
