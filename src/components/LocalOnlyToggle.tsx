import type { AiGeneration } from "./useAiGeneration";

/**
 * LocalOnlyToggle — the local-model-only egress control, shared by AiPanel + LlmAssist so it
 * reads identically on both AI surfaces. Tucked into a collapsed "上級設定" disclosure (it's a
 * niche privacy switch, not everyday UI) — but it AUTO-EXPANDS and shows a badge while active, so
 * an enabled block is never hidden. When on, the provider <select>s hide cloud providers and
 * generation is hard-blocked from any non-local target (enforced in useAiGeneration.canGenerate
 * AND ipc/ai.generateWithAI — this checkbox is just the UI).
 */
export default function LocalOnlyToggle({ ai }: { ai: AiGeneration }) {
  return (
    <details open={ai.localModelOnly} className="text-[11px]">
      <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-300 flex items-center gap-1.5">
        <span>⚙ 上級設定</span>
        {ai.localBlocked && (
          <span className="px-1.5 py-0.5 rounded bg-[#7f1d1d] text-[#fecaca] text-[10px]">
            クラウド送信ブロック中
          </span>
        )}
      </summary>
      <label
        className="mt-1.5 flex items-center gap-1.5 text-gray-300 cursor-pointer select-none"
        title="クラウドのプロバイダ/エンドポイントへの送信をブロックし、ローカル（Ollama / localhost / LAN）のみ許可します"
      >
        <input
          type="checkbox"
          checked={ai.localModelOnly}
          onChange={(e) => ai.setLocalModelOnly(e.target.checked)}
          className="accent-[#3B82F6]"
        />
        🔒 ローカルモデル限定
      </label>
    </details>
  );
}
