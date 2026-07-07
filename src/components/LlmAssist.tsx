/**
 * LlmAssist.tsx — the "AIで生成" dialog (whole-deck generation, opened from Draft/Import).
 * Distinct from the top-bar "AI Assist" dock (AiPanel), which EDITS the current deck.
 *
 * Primary flow: describe a request → generate slide Markdown / diagram JSON
 * directly with the selected AI provider (BYOK), streamed live → import.
 * Providers: Claude (native) + any OpenAI-compatible endpoint
 * (OpenAI / OpenRouter / Ollama / custom). Fallback: copy prompt to any LLM.
 *
 * Generation logic is shared with the in-Edit Ai dock via useAiGeneration, so
 * the two surfaces never diverge.
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { generateCombinedPrompt, DIAGRAM_TYPES } from "../engine/llm-prompts";
import { PROVIDERS, type ProviderId } from "../ipc/ai";
import { runningInTauri } from "../ipc/commands";
import LocalOnlyToggle from "./LocalOnlyToggle";
import type { AiGeneration, DiagramTypeChoice } from "./useAiGeneration";
import type { LayoutCatalog } from "../engine/template-catalog";

interface LlmAssistProps {
  isOpen: boolean;
  onClose: () => void;
  onImportResult: (text: string) => void;
  /** Template capability summary prepended to whole-deck generation. */
  templateHint?: string;
  /** The loaded template's layout catalog — so the manual-copy slide prompt advertises the REAL
   *  layouts (alien-safe) instead of the canonical names (#1). */
  catalog?: LayoutCatalog;
  /** Shared AI instance (lifted to App) so config never diverges across surfaces. */
  ai: AiGeneration;
}

export default function LlmAssist({ isOpen, onClose, onImportResult, templateHint, catalog, ai }: LlmAssistProps) {
  const { t } = useTranslation();
  // The dialog only offers whole-deck or diagram generation (not single-slide).
  const [mode, setMode] = useState<"slides" | "diagram">("slides");
  // Diagram type (Stage 1 of the two-stage design): "auto" lets the AI route; a concrete type sends
  // only that shape's prompt (Stage 2). Ignored for slide-deck generation.
  const [diagramType, setDiagramType] = useState<DiagramTypeChoice>("auto");
  const [userRequest, setUserRequest] = useState("");

  // Show/hide API key + manual copy/paste fallback (UI-only state).
  const [showKey, setShowKey] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);

  const canGenerate = ai.canGenerate(userRequest);

  const handleGenerate = useCallback(() => {
    // Whole-deck generation gets the template's capabilities (kinds/columns/capacity).
    const req = mode === "slides" && templateHint ? `${templateHint}\n\n${userRequest}` : userRequest;
    ai.generate(req, mode, mode === "diagram" ? diagramType : undefined);
  }, [ai, userRequest, mode, diagramType, templateHint]);

  const handleGeneratePrompt = useCallback(() => {
    if (!userRequest.trim()) return;
    // Manual copy has no routing step, so "auto" falls back to the flowchart shape (undefined).
    const dt = mode === "diagram" && diagramType !== "auto" ? diagramType : undefined;
    setPrompt(generateCombinedPrompt(mode, userRequest, dt, catalog));
    setCopied(false);
  }, [mode, userRequest, diagramType, catalog]);

  const handleCopyPrompt = useCallback(async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [prompt]);

  const handleImport = useCallback(() => {
    if (!ai.result.trim()) return;
    onImportResult(ai.result);
    onClose();
  }, [ai.result, onImportResult, onClose]);

  if (!isOpen) return null;

  const fieldClass =
    "w-full px-3 py-2 bg-field border border-edge rounded text-sm text-fg";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/60">
      <div className="bg-canvas border border-edge rounded-lg w-[800px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <h2 className="text-fg font-semibold">{t("llmAssist.title")}</h2>
          <button onClick={onClose} className="text-muted hover:text-fg text-lg">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
          {/* Step 1: User request */}
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">
              1. What do you want to create?
            </label>
            <div className="flex gap-2 mt-1 mb-2">
              <button
                onClick={() => setMode("slides")}
                className={`px-3 py-1 text-xs rounded ${
                  mode === "slides" ? "bg-accent text-on-accent" : "bg-field text-muted"
                }`}
              >
                Slide Deck
              </button>
              <button
                onClick={() => setMode("diagram")}
                className={`px-3 py-1 text-xs rounded ${
                  mode === "diagram" ? "bg-accent text-on-accent" : "bg-field text-muted"
                }`}
              >
                Diagram
              </button>
            </div>
            {mode === "diagram" && (
              <div className="flex items-center gap-2 mb-2">
                <label className="text-xs text-muted shrink-0">{t("llmAssist.diagramTypeLabel")}</label>
                <select
                  value={diagramType}
                  onChange={(e) => setDiagramType(e.target.value as DiagramTypeChoice)}
                  className="px-2 py-1 text-xs bg-field border border-edge rounded text-fg"
                >
                  <option value="auto">{t("llmAssist.diagramTypeAuto")}</option>
                  {Object.entries(DIAGRAM_TYPES).map(([t, info]) => (
                    <option key={t} value={t}>{info.label}</option>
                  ))}
                </select>
              </div>
            )}
            <textarea
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              rows={3}
              className={fieldClass}
              placeholder={mode === "slides"
                ? t("llmAssist.requestPlaceholderSlides")
                : t("llmAssist.requestPlaceholderDiagram")
              }
            />
          </div>

          {/* Step 2: Provider & connection (BYOK) */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted uppercase tracking-wider">
              2. AI provider
            </label>
            <select
              value={ai.provider}
              onChange={(e) => ai.setProvider(e.target.value as ProviderId)}
              className={fieldClass}
            >
              {PROVIDERS.filter((p) => !ai.localModelOnly || p.local || p.id === "custom").map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <LocalOnlyToggle ai={ai} />

            {/* Connection status + local-Ollama auto-detect (setup assist) */}
            <div className="flex items-center gap-2 text-[11px]">
              <span
                className={
                  ai.connection.tone === "ok"
                    ? "text-green-400"
                    : ai.connection.tone === "err"
                      ? "text-red-400"
                      : ai.connection.tone === "checking"
                        ? "text-muted"
                        : "text-amber-400"
                }
              >
                ●
              </span>
              <span className="text-fg2">{ai.connection.label}</span>
              {ai.connection.hint && <span className="text-faint truncate">— {ai.connection.hint}</span>}
              <div className="flex-1" />
              {ai.ollamaModels && ai.ollamaModels.length > 0 && ai.provider !== "ollama" && (
                <button
                  onClick={ai.switchToOllama}
                  className="px-2 py-0.5 rounded bg-edge text-accent-soft hover:bg-edge2 shrink-0"
                  title={t("llmAssist.switchToOllamaTitle")}
                >
                  {t("llmAssist.ollamaDetected", { count: ai.ollamaModels.length })}
                </button>
              )}
              {runningInTauri() &&
                (ai.builtinStatus.kind === "idle" || ai.builtinStatus.kind === "error") &&
                (ai.provider !== "builtin" || ai.weightsPresent === false) && (
                  <button
                    onClick={ai.switchToBuiltin}
                    className="px-2 py-0.5 rounded bg-edge text-accent-soft hover:bg-edge2 shrink-0"
                    title={t("llmAssist.useBuiltinTitle")}
                  >
                    {ai.weightsPresent === false ? t("llmAssist.builtinDownload") : t("llmAssist.builtinUse")}
                  </button>
                )}
              {runningInTauri() && ai.builtinStatus.kind === "running" && (
                <button
                  onClick={ai.stopBuiltin}
                  className="px-2 py-0.5 rounded bg-edge text-fg2 hover:bg-edge2 shrink-0"
                  title={t("llmAssist.stopBuiltinTitle")}
                >
                  {t("llmAssist.stopBuiltin")}
                </button>
              )}
            </div>

            {!ai.preset.native && ai.provider !== "builtin" && (
              <input
                type="text"
                value={ai.cfg.baseURL}
                onChange={(e) => ai.setField("baseURL", e.target.value)}
                placeholder="Base URL (e.g. https://api.openai.com/v1)"
                className={`${fieldClass} font-mono text-xs`}
                autoComplete="off"
              />
            )}

            <div className="flex gap-2 items-center">
              {ai.models.length > 0 ? (
                <select
                  value={ai.cfg.model}
                  onChange={(e) => ai.setField("model", e.target.value)}
                  className={`${fieldClass} font-mono text-xs flex-1`}
                >
                  {ai.cfg.model && !ai.models.includes(ai.cfg.model) && (
                    <option value={ai.cfg.model}>{t("llmAssist.modelNotInstalled", { model: ai.cfg.model })}</option>
                  )}
                  {ai.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={ai.cfg.model}
                  onChange={(e) => ai.setField("model", e.target.value)}
                  placeholder={ai.preset.native ? "claude-opus-4-8" : "Model name (e.g. gpt-4o)"}
                  className={`${fieldClass} font-mono text-xs flex-1`}
                  autoComplete="off"
                />
              )}
              <button
                onClick={ai.refreshModels}
                type="button"
                title={t("llmAssist.refreshModelsTitle")}
                className="px-2 py-2 text-xs bg-edge text-fg2 rounded shrink-0"
              >
                ↻
              </button>
            </div>
            {!ai.preset.native && ai.models.length === 0 && (
              <span className="text-[10px] text-faint">
                {ai.modelsError
                  ? t("llmAssist.modelsFetchError", { error: ai.modelsError })
                  : t("llmAssist.modelsEmpty")}
              </span>
            )}

            {/* Base URL / API key / remember are runtime-managed for the builtin model — hide them. */}
            {ai.provider !== "builtin" && (
              <>
                <div className="flex gap-2 items-center">
                  <input
                    type={showKey ? "text" : "password"}
                    value={ai.cfg.apiKey}
                    onChange={(e) => ai.setField("apiKey", e.target.value)}
                    placeholder={ai.preset.keyRequired ? "API key" : "API key (optional for local)"}
                    className={`${fieldClass} font-mono`}
                    autoComplete="off"
                  />
                  <button
                    onClick={() => setShowKey((s) => !s)}
                    className="px-2 py-2 text-xs bg-edge text-fg2 rounded"
                    type="button"
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>

                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={ai.rememberKey}
                    onChange={(e) => ai.setRememberKey(e.target.checked)}
                  />
                  Remember on this device (stored locally)
                </label>
              </>
            )}
          </div>

          {/* Generate */}
          <div className="flex items-center gap-3">
            {ai.generating ? (
              <button
                onClick={ai.cancel}
                className="px-4 py-1.5 text-sm bg-danger hover:bg-danger text-on-accent rounded"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="px-4 py-1.5 text-sm bg-accent hover:bg-accent-hi disabled:bg-accent/30 text-on-accent rounded"
              >
                Generate
              </button>
            )}
            {ai.generating && (
              <span className="text-xs text-cyan animate-pulse">Generating…</span>
            )}
            <button
              onClick={() => setShowManual((s) => !s)}
              className="ml-auto text-xs text-faint hover:text-fg2 underline"
              type="button"
            >
              {showManual ? "Hide manual copy/paste" : "Or copy the prompt instead"}
            </button>
          </div>

          {ai.error && (
            <div className="text-xs text-danger-soft bg-danger/10 border border-danger/40 rounded px-3 py-2">
              {ai.error}
            </div>
          )}

          {ai.notice && (
            <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded px-3 py-2">
              {ai.notice}
            </div>
          )}

          {/* Manual fallback: copy prompt to any LLM */}
          {showManual && (
            <div className="border border-edge rounded p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted uppercase tracking-wider">
                  Manual — copy this prompt to your LLM
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleGeneratePrompt}
                    disabled={!userRequest.trim()}
                    className="px-3 py-1 text-xs bg-edge hover:bg-accent/40 disabled:opacity-40 text-on-accent rounded"
                  >
                    Build Prompt
                  </button>
                  {prompt && (
                    <button
                      onClick={handleCopyPrompt}
                      className="px-3 py-1 text-xs bg-edge hover:bg-accent/40 text-on-accent rounded"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  )}
                </div>
              </div>
              {prompt && (
                <textarea
                  value={prompt}
                  readOnly
                  rows={6}
                  className="w-full px-3 py-2 bg-panel border border-edge rounded text-xs text-fg2 font-mono"
                />
              )}
            </div>
          )}

          {/* Result */}
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">
              3. Result {showManual && "(or paste your LLM's response here)"}
            </label>
            <textarea
              value={ai.result}
              onChange={(e) => ai.setResult(e.target.value)}
              rows={10}
              className={`${fieldClass} mt-1 font-mono`}
              placeholder="Generated Markdown / JSON appears here as the AI writes it…"
            />
            <button
              onClick={handleImport}
              disabled={!ai.result.trim() || ai.generating}
              className="mt-2 px-4 py-1.5 text-sm bg-accent hover:bg-accent-hi disabled:bg-accent/30 text-on-accent rounded"
            >
              Import to SlideCraft
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
