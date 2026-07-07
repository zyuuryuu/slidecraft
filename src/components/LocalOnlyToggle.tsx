import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <details open={ai.localModelOnly} className="text-[11px]">
      <summary className="cursor-pointer select-none text-faint hover:text-fg2 flex items-center gap-1.5">
        <span>⚙ {t("localOnly.advancedSettings")}</span>
        {ai.localBlocked && (
          <span className="px-1.5 py-0.5 rounded bg-danger text-danger-soft text-[10px]">
            {t("localOnly.cloudBlockedBadge")}
          </span>
        )}
      </summary>
      <label
        className="mt-1.5 flex items-center gap-1.5 text-fg2 cursor-pointer select-none"
        title={t("localOnly.toggleTitle")}
      >
        <input
          type="checkbox"
          checked={ai.localModelOnly}
          onChange={(e) => ai.setLocalModelOnly(e.target.checked)}
          className="accent-accent"
        />
        🔒 {t("localOnly.localModelOnly")}
      </label>
    </details>
  );
}
