import { PROVIDERS } from "../ipc/ai";
import { runningInTauri } from "../ipc/commands";
import type { AiGeneration } from "./useAiGeneration";
import LocalOnlyToggle from "./LocalOnlyToggle";

const field = "px-2 py-1 bg-field border border-edge rounded text-xs text-fg";

/**
 * AiSettingsPopover — the AI configuration (provider / model / endpoint / key / 上級), pulled out
 * of AiPanel's inline fold into a popover so the assist panel stays focused on GENERATING, not
 * configuring (a dev switches providers often; a user sets it once — [[ux_direction]]). The hook
 * logic (useAiGeneration) is unchanged: this is a pure re-home of the same controls.
 */
export default function AiSettingsPopover({ ai }: { ai: AiGeneration }) {
  const toneColor =
    ai.connection.tone === "ok" ? "text-green-400"
    : ai.connection.tone === "err" ? "text-red-400"
    : ai.connection.tone === "checking" ? "text-muted"
    : "text-amber-400";
  return (
    <div className="flex flex-col gap-2.5 p-3">
      <div className="text-[11px] font-medium text-fg2">AI 設定</div>

      <div className="flex items-center gap-2 text-[11px] flex-wrap">
        <span className={toneColor}>●</span>
        <span className="text-fg2">{ai.connection.label}</span>
        {ai.connection.hint && <span className="text-faint">— {ai.connection.hint}</span>}
      </div>

      <div className="flex items-center gap-2 text-[11px] flex-wrap">
        <span className="shrink-0 text-muted">プロバイダ</span>
        <select
          value={ai.provider}
          onChange={(e) => ai.setProvider(e.target.value as typeof ai.provider)}
          className={field}
        >
          {PROVIDERS.filter((p) => !ai.localModelOnly || p.local || p.id === "custom").map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        {ai.ollamaModels && ai.ollamaModels.length > 0 && ai.provider !== "ollama" && (
          <button
            onClick={ai.switchToOllama}
            className="px-2 py-0.5 rounded bg-field text-accent-soft hover:bg-edge border border-edge"
            title="ローカルの Ollama に切り替え"
          >
            🦙 Ollama → 使う
          </button>
        )}
        {runningInTauri() &&
          (ai.builtinStatus.kind === "idle" || ai.builtinStatus.kind === "error") &&
          (ai.provider !== "builtin" || ai.weightsPresent === false) && (
            <button
              onClick={ai.switchToBuiltin}
              className="px-2 py-0.5 rounded bg-field text-accent-soft hover:bg-edge border border-edge"
              title="オフラインの組み込みモデルを使う（初回はモデルを自動ダウンロード）"
            >
              {ai.weightsPresent === false
                ? `⬇ ${ai.builtinModel?.display ?? "オフラインAI"}（初回DL ${ai.builtinModel ? (ai.builtinModel.sizeMb / 1024).toFixed(1) : "?"}GB）`
                : "💻 オフラインAIを使う"}
            </button>
          )}
        {runningInTauri() && ai.builtinStatus.kind === "running" && (
          <button
            onClick={ai.stopBuiltin}
            className="px-2 py-0.5 rounded bg-field text-fg2 hover:bg-edge border border-edge"
            title="組み込みAIを停止してメモリを解放（次の生成で自動起動）"
          >
            ⏹ 停止
          </button>
        )}
      </div>

      <LocalOnlyToggle ai={ai} />

      <div className="flex flex-wrap items-center gap-2">
        {!ai.preset.native && ai.provider !== "builtin" && (
          <input
            className={`${field} w-56`}
            placeholder="Base URL"
            value={ai.cfg.baseURL}
            onChange={(e) => ai.setField("baseURL", e.target.value)}
          />
        )}
        {ai.provider === "builtin" && ai.builtinStatus.kind !== "running" ? (
          // The builtin model is capability-selected + auto-adopted, not user-typed — show it
          // read-only (the real tier model, not a stale saved name) until it's actually running.
          <span className={`${field} w-44 text-muted flex items-center`}>
            {ai.builtinModel?.display ?? "組み込みモデル"}
          </span>
        ) : ai.models.length > 0 ? (
          <select
            className={`${field} w-44`}
            value={ai.cfg.model}
            onChange={(e) => ai.setField("model", e.target.value)}
          >
            {ai.cfg.model && !ai.models.includes(ai.cfg.model) && (
              <option value={ai.cfg.model}>{ai.cfg.model}（未インストール）</option>
            )}
            {ai.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <input
            className={`${field} w-40`}
            placeholder="model"
            value={ai.cfg.model}
            onChange={(e) => ai.setField("model", e.target.value)}
          />
        )}
        <button
          onClick={ai.refreshModels}
          type="button"
          title="インストール済みモデルを取得"
          className={`${field} hover:bg-edge`}
        >
          ↻
        </button>
        {/* API key / remember are unused for the runtime-managed builtin model — hide them. */}
        {ai.provider !== "builtin" && (
          <>
            <input
              className={`${field} w-56`}
              type="password"
              placeholder={ai.preset.keyRequired ? "API key" : "API key (任意)"}
              value={ai.cfg.apiKey}
              onChange={(e) => ai.setField("apiKey", e.target.value)}
            />
            <label className="flex items-center gap-1 text-xs text-muted">
              <input
                type="checkbox"
                checked={ai.rememberKey}
                onChange={(e) => ai.setRememberKey(e.target.checked)}
              />
              キーを記憶
            </label>
          </>
        )}
      </div>
    </div>
  );
}
