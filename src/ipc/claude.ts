/**
 * claude.ts — Direct Claude API client for AI Assist (BYOK).
 *
 * Runs in the browser / Tauri WebView via the official SDK with
 * `dangerouslyAllowBrowser` — the user supplies their own API key, which stays
 * on their machine. Lives in ipc/ (runtime layer), not engine/, because it
 * touches the network.
 */

import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-opus-4-8";

export interface GenerateOptions {
  apiKey: string;
  system: string;
  userRequest: string;
  model?: string;
  /** Called with the running full text as tokens stream in. */
  onText?: (fullText: string) => void;
  signal?: AbortSignal;
}

/**
 * Generate slide Markdown / diagram JSON with Claude, streaming the result.
 * Resolves with the final text. Throws an Error with a user-facing message.
 */
export async function generateWithClaude(opts: GenerateOptions): Promise<string> {
  if (!opts.apiKey.trim()) {
    throw new Error("API key is required. Enter your Claude API key first.");
  }

  const client = new Anthropic({
    apiKey: opts.apiKey.trim(),
    dangerouslyAllowBrowser: true,
  });

  try {
    const stream = client.messages.stream(
      {
        model: opts.model ?? DEFAULT_MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        system: opts.system,
        messages: [{ role: "user", content: opts.userRequest }],
      },
      { signal: opts.signal },
    );

    let full = "";
    stream.on("text", (delta) => {
      full += delta;
      opts.onText?.(full);
    });

    const final = await stream.finalMessage();

    if (final.stop_reason === "refusal") {
      throw new Error("Claude declined this request. Try rephrasing it.");
    }

    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return (text || full).trim();
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) {
    return "Generation cancelled.";
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return "Authentication failed — check your API key.";
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return "Your API key lacks access to this model.";
  }
  if (e instanceof Anthropic.RateLimitError) {
    return "Rate limited — wait a moment and try again.";
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Claude API — check your connection.";
  }
  if (e instanceof Anthropic.APIError) {
    return `Claude API error (${e.status ?? "?"}): ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
