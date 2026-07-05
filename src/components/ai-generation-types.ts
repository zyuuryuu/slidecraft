/**
 * ai-generation-types.ts — the types, constants and PURE helpers behind useAiGeneration.
 *
 * Split out of useAiGeneration.ts (R1 400-line cap): everything here is framework-free (no hooks,
 * no React state) so it can be unit-tested and imported without pulling in the hook. The hook wires
 * these into state/effects; the response shaping (postProcessAiResult) and failure classification
 * (classifyAiFailure) live here as plain functions.
 */
import type { LayoutCatalog } from "../engine/template-catalog";
import { extractDeckPlan, deckPlanToDeck, stripMarkdownFence } from "../engine/deck-plan";
import { sanitizeSlideEditOutput } from "../engine/edit-sanitize";
import { serializeMd } from "../engine/md-serializer";
import { DiagramSpecSchema } from "../engine/schema";
import { diagramSpecToYaml } from "../engine/mermaid-to-diagram";
import { parseJsonLoose } from "../engine/json-salvage";
import { parseTemplateSpecResponse } from "../engine/template-spec-prompts";
import { PROVIDERS, type ProviderId } from "../ipc/ai";
import type { DiagramType } from "../engine/llm-prompts";
import { AI_CONFIG_STORAGE } from "../ipc/key-store";

/** Diagram-mode type choice: a concrete shape, or "auto" → Stage-1 routing picks it. */
export type DiagramTypeChoice = DiagramType | "auto";

/** Local-model-only toggle persists to its OWN key, UNCONDITIONALLY (a security setting
 *  must not depend on the "remember API key" opt-in that gates AI_CONFIG_STORAGE). */
export const LOCAL_ONLY_STORAGE = "slidecraft_local_only";

/** Best-of-N candidate count (single-slide edit). Persists to its own key. N=1 disables best-of-N.
 *  HARD-clamped to [1, MAX_BEST_OF_N] so a mistaken huge value (e.g. 100) can never spawn a runaway
 *  fan-out (100 offline generations would exhaust memory/time). */
export const BEST_OF_N_STORAGE = "slidecraft_best_of_n";
export const MAX_BEST_OF_N = 5;
export const clampBestOfN = (n: number): number => Math.max(1, Math.min(MAX_BEST_OF_N, Math.floor(Number(n) || 1)));

export interface AiProviderConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}
export type AiConfigMap = Record<ProviderId, AiProviderConfig>;
/** The capability-selected default offline model (from Rust model_tier::builtin_model_info). */
export interface BuiltinModelInfo { tier: "small" | "balanced"; display: string; file: string; sizeMb: number; }
export type AiMode = "slides" | "slide" | "condense" | "diagram" | "diagram-edit" | "template-spec";

export type AiTaskStatus = "running" | "done" | "error" | "cancelled";
/** One AI request as a tracked task — the unit of the central task store. Every
 *  surface (AiPanel, LlmAssist, the refine loop) submits these, so progress, history
 *  and cancellation are uniform and a manual request can't silently collide with the
 *  loop's per-slide calls. */
export interface AiTask {
  id: string;
  docId: string; // the document this task belongs to (multi-document scoping)
  mode: AiMode;
  label: string; // human scope, e.g. "スライド3を整形" / "デッキ生成"
  prompt: string;
  status: AiTaskStatus;
  result: string; // streamed live, then post-processed on done
  error?: string;
  notice?: string; // non-blocking 告知 (e.g. deterministic-repair dropped a corrupt unit)
  diagramType?: DiagramTypeChoice; // diagram mode: chosen shape ("auto" → resolved by the route call)
  startedAt: number;
  finishedAt?: number;
}

export const MAX_TASKS = 50; // keep the most recent N in history

export const MODE_LABEL: Record<AiMode, string> = {
  slides: "デッキ生成",
  slide: "スライド整形",
  condense: "本文を要約",
  diagram: "図の生成",
  "diagram-edit": "図の編集",
  "template-spec": "テンプレ提案",
};

/** Classify a failed AI call so the refine loop can decide whether to retry: a cancel
 *  never retries; config/auth errors won't fix themselves; transient failures (network,
 *  timeout, rate-limit, 5xx, empty/garbled response) are worth another try or two. */
export function classifyAiFailure(e: unknown, signal?: AbortSignal): { cancelled: boolean; retryable: boolean; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (message === "cancelled" || signal?.aborted) return { cancelled: true, retryable: false, message };
  const m = message.toLowerCase();
  const permanent = /\b(401|403|404)\b|unauthorized|invalid api key|\bapi key\b|model not found|no such model/.test(m);
  return { cancelled: false, retryable: !permanent, message };
}

export function defaultConfigs(): AiConfigMap {
  const out = {} as AiConfigMap;
  for (const p of PROVIDERS) {
    out[p.id] = { baseURL: p.baseURL, model: p.model, apiKey: "" };
  }
  return out;
}

/** Blank the builtin runtime's baseURL. It's an EPHEMERAL per-run port (llamafile picks it on spawn),
 *  so it must NEVER persist/restore: a stale endpoint from a past session defeats auto-start-on-generate
 *  (which only fires when baseURL is empty) and shows "接続できません" against a dead port. Applied to any
 *  config coming from / going to storage; a fresh install's builtin baseURL is already "", so it's a no-op. */
export function freshBuiltin(cfgs: AiConfigMap): AiConfigMap {
  return cfgs.builtin ? { ...cfgs, builtin: { ...cfgs.builtin, baseURL: "" } } : cfgs;
}

/** Read persisted AI config ONCE — used as a lazy useState initializer (NOT a mount effect), so
 *  there is no synchronous setState / cascading render on mount. Seeds the state + hadSavedConfig. */
export function loadSavedConfig(): { localOnly: boolean; bestOfN: number; provider?: ProviderId; configs?: Partial<AiConfigMap>; hadSaved: boolean } {
  try {
    const localOnly = localStorage.getItem(LOCAL_ONLY_STORAGE) === "1";
    const bestOfN = clampBestOfN(Number(localStorage.getItem(BEST_OF_N_STORAGE) ?? 1));
    const raw = localStorage.getItem(AI_CONFIG_STORAGE);
    if (!raw) return { localOnly, bestOfN, hadSaved: false };
    const saved = JSON.parse(raw) as { provider?: ProviderId; configs?: Partial<AiConfigMap> };
    return { localOnly, bestOfN, provider: saved.provider, configs: saved.configs, hadSaved: true };
  } catch {
    return { localOnly: false, bestOfN: 1, hadSaved: false };
  }
}

/** Mode-specific post-processing: the model's raw text → the form each surface uses
 *  (slides → engine Markdown, slide → fenced Markdown, diagram-edit → validated YAML). Returns
 *  either a result or a human error — centralised so every task path (foreground + loop) treats
 *  responses identically. Pure (no state); the hook wraps it in a useCallback bound to `catalog`. */
export function postProcessAiResult(mode: AiMode, raw: string, catalog?: LayoutCatalog): { result?: string; error?: string; notice?: string } {
  if (mode === "slides") {
    const parsed = extractDeckPlan(raw);
    // Pass the catalog so a kind the master can't express (table/columns/diagram) is degraded to
    // content bullets deterministically, instead of emitting an unrenderable slide (#11).
    if (!parsed.ok) return { error: `Couldn't read the generated plan: ${parsed.error}` };
    const notice = parsed.notices?.length ? parsed.notices.join(" / ") : undefined;
    return { result: serializeMd(deckPlanToDeck(parsed.plan, catalog)), ...(notice ? { notice } : {}) };
  }
  if (mode === "slide" || mode === "condense") {
    // Strip the meta-chatter a weak offline model leaks (format label / echoed Instruction / prose
    // note) BEFORE the diff/reconcile sees it — harness over model (ADR-0016 の相談メモ・edit-sanitize).
    const md = sanitizeSlideEditOutput(stripMarkdownFence(raw));
    return md
      ? { result: md }
      : { error: "有効な編集が生成できませんでした。具体的な指示（例: 要約 / 箇条書きに整形 / 図を追加 / 英語に翻訳）でお試しください。" };
  }
  if (mode === "diagram-edit") {
    const r = parseJsonLoose(raw);
    if (!r.ok) return { error: "Couldn't find a diagram in the response." };
    const parsed = DiagramSpecSchema.safeParse(r.value);
    return parsed.success ? { result: diagramSpecToYaml(parsed.data) } : { error: `Invalid diagram: ${parsed.error.issues[0]?.message}` };
  }
  if (mode === "template-spec") {
    // AI は提案のみ — 検証・フォールバック・コントラスト修正は決定論（ADR-0005）。result は
    // 正規化済み TemplateSpec の JSON（TemplateCreator が parse してフォームに反映する）。
    const r = parseTemplateSpecResponse(raw);
    if (!r.ok) return { error: r.error };
    return { result: JSON.stringify(r.spec), ...(r.notices.length ? { notice: r.notices.join(" / ") } : {}) };
  }
  return { result: raw }; // "diagram" → raw passthrough
}

export interface ConnectionStatus { ok: boolean; tone: "ok" | "warn" | "err" | "checking"; label: string; hint?: string; }

/** Derive a human-readable connection status for the CURRENT provider + an actionable hint when it
 *  isn't ready. Pure function of the resolved config/runtime state, so the hook just feeds it values. */
export function computeConnection(a: {
  provider: ProviderId;
  preset: { native: boolean; keyRequired: boolean };
  cfg: AiProviderConfig;
  builtinStatus: { kind: string; message?: string; pct?: number };
  weightsPresent: boolean | null;
  builtinModel: BuiltinModelInfo | null;
  modelsLoading: boolean;
  modelsError: string | null;
  models: string[];
}): ConnectionStatus {
  const { provider, preset, cfg, builtinStatus, weightsPresent, builtinModel, modelsLoading, modelsError, models } = a;
  const isOllama = provider === "ollama";
  if (preset.native) {
    if (preset.keyRequired && !cfg.apiKey.trim()) return { ok: false, tone: "warn", label: "APIキー未設定", hint: "下の設定に Anthropic の API キーを入力" };
    if (!cfg.model.trim()) return { ok: false, tone: "warn", label: "モデル未選択" };
    return { ok: true, tone: "ok", label: `${cfg.model} を使用` };
  }
  if (provider === "builtin") {
    if (builtinStatus.kind === "downloading") return { ok: false, tone: "checking", label: `${builtinModel?.display ?? "モデル"} をダウンロード中… ${builtinStatus.pct ?? 0}%` };
    if (builtinStatus.kind === "starting") return { ok: false, tone: "checking", label: "オフラインAIを起動中…（初回は数十秒）" };
    if (builtinStatus.kind === "error") return { ok: false, tone: "err", label: "オフラインAIの起動に失敗", hint: builtinStatus.message };
    if (!cfg.baseURL.trim()) {
      return weightsPresent === false
        ? { ok: false, tone: "warn", label: `${builtinModel?.display ?? "オフラインAI"} 未取得`, hint: `⬇ ボタンで初回ダウンロード（約${builtinModel ? (builtinModel.sizeMb / 1024).toFixed(1) : "?"}GB）` }
        : { ok: false, tone: "warn", label: "オフラインAI 未起動", hint: "そのまま生成すると自動で起動します（初回は数十秒）" };
    }
    // baseURL is set but the runtime isn't answering (a stale port from a past session, or it stopped).
    // Give the ACTIONABLE fix instead of the generic "接続できません".
    if (modelsError) return { ok: false, tone: "err", label: "オフラインAIが応答しません", hint: "設定の「💻 起動」で再起動できます（または、そのまま生成すると自動で起動します）" };
    // baseURL filled + reachable → fall through to the generic model checks below.
  }
  if (!cfg.baseURL.trim()) return { ok: false, tone: "warn", label: "Base URL 未設定" };
  if (modelsLoading) return { ok: false, tone: "checking", label: "接続を確認中…" };
  if (modelsError) {
    return isOllama
      ? { ok: false, tone: "err", label: "Ollama に接続できません", hint: "`ollama serve` で起動（既定 localhost:11434）" }
      : { ok: false, tone: "err", label: "接続できません", hint: `エンドポイントを確認（${modelsError}）` };
  }
  if (models.length === 0) {
    return { ok: false, tone: "warn", label: "利用可能なモデルがありません", hint: isOllama ? "`ollama pull qwen2.5` 等でモデルを取得" : "モデル名を確認" };
  }
  if (preset.keyRequired && !cfg.apiKey.trim()) return { ok: false, tone: "warn", label: "APIキー未設定" };
  if (!cfg.model.trim() || !models.includes(cfg.model)) return { ok: false, tone: "warn", label: "モデルを選択", hint: `${models.length} 個のモデルが利用可` };
  return { ok: true, tone: "ok", label: `${cfg.model}（接続OK・${models.length} モデル）` };
}
