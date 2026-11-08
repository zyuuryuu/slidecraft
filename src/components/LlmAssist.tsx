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
import AiSettingsPopover from "./AiSettingsPopover";
import type { AiGeneration, DiagramTypeChoice } from "./useAiGeneration";
import { toneClass } from "./ai-generation-types";
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

  // The AI connection settings fold + manual copy/paste fallback (UI-only state). #653: the fold
  // starts OPEN whenever the dialog opens with an unusable connection (connection.ok=false), so a
  // first-time user lands on what to fill in; after that it is the user's to toggle.
  // "checking"（モデル一覧の取得中・内蔵 AI の起動中）は未設定ではないので展開しない（PR #664 レビュー B-1）。
  const needsSetup = !ai.connection.ok && ai.connection.tone !== "checking";
  const [showSettings, setShowSettings] = useState(() => needsSetup);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setShowSettings(needsSetup);
  }
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
          <button onClick={onClose} title={t("llmAssist.close")} className="text-muted hover:text-fg text-lg">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
          {/* Step 1: User request */}
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">{t("llmAssist.stepRequest")}</label>
            <div className="flex gap-2 mt-1 mb-2">
              <button
                onClick={() => setMode("slides")}
                className={`px-3 py-1 text-xs rounded ${
                  mode === "slides" ? "bg-accent text-on-accent" : "bg-field text-muted"
                }`}
              >
                {t("llmAssist.modeSlides")}
              </button>
              <button
                onClick={() => setMode("diagram")}
                className={`px-3 py-1 text-xs rounded ${
                  mode === "diagram" ? "bg-accent text-on-accent" : "bg-field text-muted"
                }`}
              >
                {t("llmAssist.modeDiagram")}
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

          {/* Step 2: the AI connection. #615: its inputs live ONLY in AiSettingsPopover (the same
              component the AI dock's ⚙ opens, on the same shared `ai`) — here we show the status and
              open that component inline, so the two surfaces can't drift apart. */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted uppercase tracking-wider">{t("llmAssist.stepConnection")}</label>
            <button
              type="button"
              data-testid="llm-ai-settings-toggle"
              aria-expanded={showSettings}
              onClick={() => setShowSettings((v) => !v)}
              title={t("llmAssist.connectionSettingsTitle")}
              className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border border-edge bg-field hover:bg-edge text-left"
            >
              <span className={toneClass(ai.connection.tone)}>●</span>
              <span className="text-fg2">{ai.connection.label}</span>
              {ai.connection.hint && <span className="text-faint min-w-0 truncate">— {ai.connection.hint}</span>}
              <span className="ml-auto shrink-0 text-muted">⚙ {t("aiSettings.title")} {showSettings ? "▾" : "▸"}</span>
            </button>
            {showSettings && (
              <div className="rounded border border-edge bg-panel">
                <AiSettingsPopover ai={ai} surface="dialog" />
              </div>
            )}
          </div>

          {/* Generate */}
          <div className="flex items-center gap-3">
            {ai.generating ? (
              <button
                onClick={ai.cancel}
                className="px-4 py-1.5 text-sm bg-danger hover:bg-danger text-on-accent rounded"
              >
                {t("llmAssist.cancel")}
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="px-4 py-1.5 text-sm bg-accent hover:bg-accent-hi disabled:bg-accent/30 text-on-accent rounded"
              >
                {t("llmAssist.generate")}
              </button>
            )}
            {ai.generating && (
              <span className="text-xs text-cyan animate-pulse">{t("llmAssist.generating")}</span>
            )}
            <button
              onClick={() => setShowManual((s) => !s)}
              className="ml-auto text-xs text-faint hover:text-fg2 underline"
              type="button"
            >
              {showManual ? t("llmAssist.hideManual") : t("llmAssist.showManual")}
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
                <label className="text-xs text-muted uppercase tracking-wider">{t("llmAssist.manualLabel")}</label>
                <div className="flex gap-2">
                  <button
                    onClick={handleGeneratePrompt}
                    disabled={!userRequest.trim()}
                    className="px-3 py-1 text-xs bg-edge hover:bg-accent/40 disabled:opacity-40 text-on-accent rounded"
                  >
                    {t("llmAssist.buildPrompt")}
                  </button>
                  {prompt && (
                    <button
                      onClick={handleCopyPrompt}
                      className="px-3 py-1 text-xs bg-edge hover:bg-accent/40 text-on-accent rounded"
                    >
                      {copied ? t("llmAssist.copied") : t("llmAssist.copy")}
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
              {t("llmAssist.stepResult")}{showManual && ` ${t("llmAssist.stepResultPaste")}`}
            </label>
            <textarea
              value={ai.result}
              onChange={(e) => ai.setResult(e.target.value)}
              rows={10}
              className={`${fieldClass} mt-1 font-mono`}
              placeholder={t("llmAssist.resultPlaceholder")}
            />
            <button
              onClick={handleImport}
              disabled={!ai.result.trim() || ai.generating}
              className="mt-2 px-4 py-1.5 text-sm bg-accent hover:bg-accent-hi disabled:bg-accent/30 text-on-accent rounded"
            >
              {t("llmAssist.importToSlideCraft")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
