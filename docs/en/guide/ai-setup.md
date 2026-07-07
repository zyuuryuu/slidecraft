# Configuring the Assistant AI

SlideCraft's AI is a "tool to help you write and edit" — it will never decide anything on your behalf. Every result passes through an **adoption gate** (diff view) before it is applied, and you choose to accept or reject it. You are also free to choose where the AI runs.

- **Built-in offline AI (llamafile)** — runs entirely on your own machine with no extra setup. Nothing is sent to the cloud.
- **External providers (BYOK)** — connect to Anthropic / OpenAI / OpenRouter / Ollama and others with your own API key.

This page explains how to set up both, and how the [privacy](#privacy) side works. For what the AI can help with (the overall picture of generation and editing), see [Markdown Authoring](/en/guide/markdown-authoring) and [Diagrams](/en/guide/diagrams) as well.

::: tip It works without AI, too
The AI is strictly an aid. Markdown authoring, template filling, diagrams, and PPTX/HTML export all work without enabling the AI. The basic workflow is "write it yourself first, then let the AI help with the details."
:::

---

## Built-in offline AI (llamafile)

The desktop version ships with an **offline AI runtime (a llamafile sidecar)** built in. On the desktop version this is the default provider. Nothing is ever sent to the cloud — the model weights, your input, and the output all stay on your machine.

Internally, enabling it starts an OpenAI-compatible server locally (on the `127.0.0.1` loopback), and SlideCraft talks to it there. Because the destination is always loopback, it is also treated as "local" by the [local-model-only mode](#local-model-only-mode) check described below.

### Enabling it and the first-time automatic model download

1. In the AI settings, set the provider to "Built-in (llamafile, offline)" (the desktop default).
2. **The first time only**, a model matched to your machine's capabilities (RAM and core count) is downloaded automatically. The download includes an integrity check (SHA256 verification), and is rejected if it does not match.
3. From then on it runs from the local model file, so you can generate and edit even offline.

The automatically selected model has two tiers.

| Tier | Default model | Approx. size | Selection condition |
|---|---|---|---|
| Small | Phi-3.5-mini 3.8B | ~2.4 GB | Modest environments (safe lower bound) |
| Balanced | Granite 4.1 8B | ~5 GB | 12 GB RAM or more **and** 4 cores or more |

The decision is simple: **total RAM of 12,288 MB or more AND 4 or more logical cores** selects Balanced (8B); anything below that gets Small (3.8B). The 8B model follows editing instructions more reliably, but CPU inference needs some headroom, so the design is conservative — "step up one tier only when there is headroom (never push to the max)." The settings panel shows the model name your machine would select by default and the actual download size.

::: tip Which tier will run
Roughly speaking, an 8 GB-class laptop or a 2-core machine gets Small (Phi-3.5-mini), while a 16 GB / 4-core-or-more machine gets Balanced (Granite 4.1 8B). Even Small is designed to deliver practical quality thanks to the "harness-side scaffolding" described later, such as the adoption gate and diagram type selection.
:::

### Starting, stopping, and memory

The AI **starts automatically** when you generate, and startup is designed not to freeze the UI. When you are done, you can stop the runtime with the "Stop" button to **free memory**. The next time you generate, it starts up again automatically.

::: warning It only communicates the first time
The model weights (a GGUF file) are downloaded from Hugging Face just once. **Only during this download does it go out to the network.** Once the download finishes, all subsequent generation and editing is fully offline (the contents of your slides are never sent to the cloud).
:::

---

## Generation and editing

The AI helps in two ways: "generation" and "editing." Both work with either the built-in AI or an external provider.

### Generation

- **Slide generation** — have the AI write the Draft's Markdown / create a starting point.
- **Diagram generation** — generate a DiagramSpec (see [Diagrams](/en/guide/diagrams)). Diagrams use a two-step approach — "**first decide the type, then generate with instructions dedicated to that type**" — which makes it easier to get the kind you intended (e.g. `flowchart`).

### Editing and the adoption gate

You can request changes in natural language for a single existing slide, multiple selected slides, or the whole deck. This is the important part.

**The AI's output is not applied as-is.** The output is first verified by the **adoption gate**, and after you review the differences from the original in the diff view, you choose to accept or reject. It never silently pulls in broken output or changes that go against your instructions.

### best-of-N (choosing from multiple candidates)

For editing a single slide, you can **generate multiple candidates at once and pick the best one** (best-of-N).

- The number of candidates is configured in the range **1–5** (`1` = a normal single generation). The value you set is clamped to this range and remembered.
- Candidates are fanned out and generated in parallel, and each is **scored by the adoption gate**. Candidates without constraint violations (HARD violations such as overflow) are prioritized, the best one is presented, and you can choose from the picker. The degree of parallelism is adjusted automatically based on your machine's RAM.

::: tip best-of-N is a trade-off against cost
The more candidates you add, the more likely you are to hit a high-quality result, but generation takes correspondingly more time (and, with an external provider, more API cost). The built-in AI incurs no billing, but CPU time increases. We recommend starting with `2`–`3`.
:::

---

## External providers (BYOK)

Instead of the built-in AI, you can use the cloud or a different local runtime with **your own API key (Bring Your Own Key)**. The providers you can configure are as follows.

| Provider | Connection method | API key | Example default model | Notes |
|---|---|---|---|---|
| Claude (Anthropic) | Native Anthropic SDK | Required | `claude-opus-4-8` | Cloud only |
| OpenAI | OpenAI-compatible | Required | `gpt-4o` | `https://api.openai.com/v1` |
| OpenRouter | OpenAI-compatible | Required | `openai/gpt-4o` | `https://openrouter.ai/api/v1` |
| Ollama (local) | OpenAI-compatible | Not needed | `llama3.1` | `http://localhost:11434/v1` |
| Built-in (llamafile) | OpenAI-compatible (loopback) | Not needed | — | The offline AI above |
| Custom (OpenAI-compatible) | OpenAI-compatible | Optional | Free-form | Specify the Base URL and model name yourself |

Only Claude connects via the native Anthropic SDK; everything else connects via **OpenAI-compatible Chat Completions** (`/v1/chat/completions`). In other words, with Custom you can connect to any OpenAI-compatible endpoint, such as Groq, Together, Mistral, DeepSeek, LM Studio, or vLLM.

### Setup steps

1. Select the provider in the AI settings.
2. Enter the **API key** (required for Claude / OpenAI / OpenRouter; often not needed for Ollama or local runtimes).
3. For Custom, enter the **Base URL** and model name. If the endpoint supports it, the list of installed models can be fetched automatically and shown in the dropdown.

::: warning Non-local destinations require https
So that the API key is never leaked in plaintext, **`https://` is required for any destination other than local / loopback / LAN**. `http://` cloud endpoints are rejected (because they would send `Authorization: Bearer <key>` in plaintext). Local destinations (`localhost`, `127.0.0.1`, or a private LAN IP) can stay on `http://`.
:::

::: tip First-time confirmation for Custom endpoints
The first time you send to an external host other than a preset (a free-form Custom cloud destination), a dialog appears once asking whether it is OK to send a request containing your API key to that destination. Once you approve, that machine trusts that host from then on. No confirmation appears for presets such as Anthropic / OpenAI / OpenRouter, or for local destinations. This exists to prevent accidents where you are lured into a malicious Base URL.
:::

---

## Local-model-only mode

This is a hard switch for situations where you "never want data sent from the GUI to the model to leave this machine / LAN." Turn on **🔒 Local Models Only**, found inside Advanced Settings (`⚙ Advanced Settings`).

- While it is on, **cloud providers are hidden** from the provider selector.
- Sending to cloud providers / endpoints is **hard-blocked** (rejected just before the network call). It is enforced not only on the UI side but also at the final point of the generation path — a double guard — so nothing leaks even through paths that bypass the UI.
- While it is on, Advanced Settings expands automatically and a "Cloud sending blocked" badge is shown, so you will not fail to notice that it is active.

The only destinations allowed are **local ones**. Specifically: the built-in llamafile, `localhost` / loopback (`127.0.0.1`, `::1`), RFC1918 private IPs (`10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`), and link-local (`169.254.0.0/16`).

::: tip Built-in AI + this mode is the safest
The built-in offline AI is always a loopback server, so you can use it normally even with this mode turned on. The combination of "built-in AI + local-model-only mode" is the safest default when handling confidential material.
:::

---

## Privacy

SlideCraft's AI follows the policy of "local by default, explicit when sending."

- **The built-in AI is offline.** Except for the first-time download of the model weights, all generation and editing is completed on your machine, and slide contents never leave for the cloud.
- **Your BYOK key stays on your machine.** When you use an external provider, the API key is stored in the **OS keychain** wherever possible (Windows Credential Manager / macOS Keychain / Linux Secret Service), rather than in JS-readable `localStorage` plaintext. In environments without a keychain (browser / demo, or Linux without Secret Service), it falls back to `localStorage` as before. Turning off "Remember key" erases it from both.
- **External sending is explicit.** Non-local destinations require https, cloud hosts outside the presets get a confirmation dialog the first time, and local-model-only mode seals off sending altogether.

::: warning This is "convenience-side defense"
Keychain storage and confirmation dialogs prevent plaintext storage and attacks that trick a person into sending to a malicious destination. However, they are not a defense against the webview itself being compromised (because the key sits in JS memory at send time). If you need the hardest defense, use the built-in AI + local-model-only mode to keep everything from leaving in the first place.
:::

---

## Troubleshooting

::: details Clicking generate doesn't send to the external provider
When local-model-only mode is on, cloud destinations are blocked. Check whether the "Cloud sending blocked" badge is showing in Advanced Settings. Turn it off, or use the built-in AI / a local runtime.
:::

::: details "Unsafe Base URL" appears
You have specified `http://` for a non-local destination. Change it to `https://`. Local destinations (`localhost` / `127.0.0.1` / private IP) can stay on `http://`.
:::

::: details Can't connect to Ollama (CORS, etc.)
The desktop version routes requests through Rust, so you normally won't hit CORS problems. If you use it in browser / dev mode, check the Base URL, that the server is running, and CORS permissions. Ollama's default is `http://localhost:11434/v1`.
:::

::: details The built-in AI's first-time download fails
The download includes SHA256 verification and is rejected if the contents don't match. Check your network and retry. Communication is only needed during the download.
:::

If you want to connect an AI agent (such as Claude Desktop or Claude Code) **from upstream** and have it edit for you, see [MCP](/en/guide/mcp) rather than this page. For everything else, see the [FAQ](/en/guide/faq), and for templates see [Templates](/en/guide/templates).
