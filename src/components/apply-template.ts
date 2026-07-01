/**
 * apply-template.ts — apply .pptx bytes as the active document's template, through the acceptance
 * gate. Extracted from useDeckController.handleLoadTemplate so EVERY "pick a master" path (the
 * top-bar loader AND the draft master picker) shares one gated apply — a rejected/unusable master is
 * never silently applied. Takes the doc-store setters (no DOM/Tauri here), so it's unit-testable.
 */
import { loadTemplate, type TemplateData } from "../engine/template-loader";
import { buildCatalog, assessTemplateHealth, type TemplateHealth } from "../engine/template-catalog";

export interface TemplateSetters {
  setTemplateData: (t: TemplateData) => void;
  setTemplateName: (n: string) => void;
  setParseError: (e: string | null) => void;
}

export interface ApplyTemplateResult {
  ok: boolean;
  health?: TemplateHealth; // present whenever the bytes parsed (even if rejected), for the caller to surface
}

/**
 * Load bytes → build catalog → assess health. REJECTED (no title/body role) surfaces a parse error
 * and is not applied; ok/degraded is set as the active template. Returns the health so the caller
 * (master picker) can show findings + usable kinds. `name` is stripped of a trailing `.pptx`.
 */
export async function applyTemplateBytes(
  buf: ArrayBuffer | Uint8Array,
  name: string,
  setters: TemplateSetters,
): Promise<ApplyTemplateResult> {
  try {
    const tpl = await loadTemplate(buf);
    const health = assessTemplateHealth(buildCatalog(tpl));
    if (health.status === "rejected") {
      const reason = health.findings.filter((f) => f.level === "block").map((f) => f.message).join(" ");
      setters.setParseError(`このテンプレートは使用できません: ${reason}`);
      return { ok: false, health };
    }
    setters.setTemplateData(tpl);
    setters.setTemplateName(name.replace(/\.pptx$/i, ""));
    return { ok: true, health };
  } catch (err) {
    setters.setParseError(`Template load failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false };
  }
}
