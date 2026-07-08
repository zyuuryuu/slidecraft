/**
 * apply-template.ts — apply .pptx bytes as the active document's template, through the acceptance
 * gate. Extracted from useDeckController.handleLoadTemplate so EVERY "pick a master" path (the
 * top-bar loader AND the draft master picker) shares one gated apply — a rejected/unusable master is
 * never silently applied. Takes the doc-store setters (no DOM/Tauri here), so it's unit-testable.
 *
 * テーマ2 スライス1: rejected は即拒否ではなく修復プラン（template-repair.ts）を提示し、呼び出し側の
 * confirm で同意されたら修復済み bytes を適用する（「整形して取り込む」）。同意 UI（Tauri ダイアログ等）
 * はここに置かず confirm コールバックで注入 — このモジュールは unit-testable のまま。
 */
import i18n from "../i18n";
import { loadTemplate, type TemplateData } from "../engine/template-loader";
import { buildCatalog, assessTemplateHealth, type TemplateHealth } from "../engine/template-catalog";
import { planRepairs, repairTemplate, type RepairPlan } from "../engine/template-repair";
import { masterToTemplateSpec, extractLogo } from "../engine/master-remake";
import { masterToLayoutInventory, remakeSystemPrompt, aiRemakeSpec } from "../engine/master-remake-ai";
import { writeTemplate } from "../engine/template-writer";

export interface TemplateSetters {
  setTemplateData: (t: TemplateData) => void;
  setTemplateName: (n: string) => void;
  setParseError: (e: string | null) => void;
}

export interface ApplyTemplateResult {
  ok: boolean;
  health?: TemplateHealth; // present whenever the bytes parsed (even if rejected), for the caller to surface
  repair?: RepairPlan; // rejected 時の修復プラン（repairable でも同意が得られなかった場合も返す）
  repairedBytes?: Uint8Array; // 修復を適用したときの登録用 bytes（レジストリにはこちらを保存する）
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
  return applyTemplateBytesWithRepair(buf, name, setters, async () => false);
}

/**
 * applyTemplateBytes の修復オファーつき版。rejected かつ修復可能なら confirm(plan) に諮り、
 * 同意 → 修復済み bytes を適用して repairedBytes で返す（呼び出し側はレジストリにこれを登録する）。
 * 拒否/修復不能 → 従来と同一の parseError で非適用。健全なマスターでは confirm は発火しない。
 */
export async function applyTemplateBytesWithRepair(
  buf: ArrayBuffer | Uint8Array,
  name: string,
  setters: TemplateSetters,
  confirmRepair: (plan: RepairPlan) => Promise<boolean>,
): Promise<ApplyTemplateResult> {
  try {
    const tpl = await loadTemplate(buf);
    const health = assessTemplateHealth(buildCatalog(tpl));
    if (health.status !== "rejected") {
      setters.setTemplateData(tpl);
      setters.setTemplateName(name.replace(/\.pptx$/i, ""));
      return { ok: true, health };
    }

    const plan = planRepairs(tpl);
    if (plan.repairable && (await confirmRepair(plan))) {
      const r = await repairTemplate(buf);
      if (r.healthAfter.status !== "rejected") {
        setters.setTemplateData(await loadTemplate(r.bytes));
        setters.setTemplateName(name.replace(/\.pptx$/i, ""));
        return { ok: true, health: r.healthAfter, repair: plan, repairedBytes: r.bytes };
      }
    }

    const reason = health.findings.filter((f) => f.level === "block").map((f) => f.message).join(" ");
    setters.setParseError(i18n.t("applyTemplate.templateUnusable", { reason }));
    return { ok: false, health, repair: plan };
  } catch (err) {
    setters.setParseError(`Template load failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false };
  }
}

export interface RemakeResult extends ApplyTemplateResult {
  remadeBytes?: Uint8Array; // the minted canonical template — register THESE bytes (not the source)
}

/**
 * Re-make intake (the SECOND import path, coexisting with faithful applyTemplateBytes): instead of
 * adopting the source master's own placeholder structure, extract its THEME (fonts + colors) and
 * re-emit SlideCraft's canonical layouts wearing it (master-remake → writeTemplate). Sidesteps the
 * third-party idx/theme quirks (ADR-0023) entirely. The minted template is canonical-healthy, so
 * there's no repair branch. Returns remadeBytes for the caller to register in the master registry.
 */
export async function applyTemplateBytesAsRemake(
  buf: ArrayBuffer | Uint8Array,
  name: string,
  setters: TemplateSetters,
): Promise<RemakeResult> {
  try {
    const source = await loadTemplate(buf);
    const cleanName = name.replace(/\.pptx$/i, "");
    const spec = masterToTemplateSpec(source, {
      name: i18n.t("applyTemplate.remakeName", { name: cleanName }),
    });
    const logo = await extractLogo(source); // lift the source's logo onto the minted layouts
    const remadeBytes = await writeTemplate(logo ? { ...spec, logo } : spec);
    const remade = await loadTemplate(remadeBytes);
    const health = assessTemplateHealth(buildCatalog(remade));
    if (health.status === "rejected") {
      // Shouldn't happen (canonical layouts always pass), but never silently apply a bad one.
      setters.setParseError(i18n.t("applyTemplate.remakeFailedValidation"));
      return { ok: false, health };
    }
    setters.setTemplateData(remade);
    setters.setTemplateName(spec.name);
    return { ok: true, health, remadeBytes };
  } catch (err) {
    setters.setParseError(
      i18n.t("applyTemplate.remakeFailed", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false };
  }
}

export interface RemakeAIResult extends RemakeResult {
  usedAi?: boolean; // true = the AI mapping was used; false = deterministic fallback (built-in 30)
  note?: string; // human-readable note about which path ran (for the UI to surface)
}

/**
 * AI Re-make (the THIRD import path, ADR-0026 / docs/design/ai-remake.md). Like applyTemplateBytesAsRemake,
 * but the AI picks which CANONICAL layouts mirror the source master (option C, structure mapping) so the
 * source's layout SET is preserved with CLEAN roles. `callAI` is INJECTED (systemPrompt → raw text | null)
 * so this stays DOM/Tauri-free + unit-testable; a null / broken / hallucinated response falls back to the
 * deterministic Re-make (aiRemakeSpec's built-in floor) — never worse than applyTemplateBytesAsRemake.
 */
export async function applyTemplateBytesAsRemakeAI(
  buf: ArrayBuffer | Uint8Array,
  name: string,
  setters: TemplateSetters,
  callAI: (systemPrompt: string) => Promise<string | null>,
): Promise<RemakeAIResult> {
  try {
    const source = await loadTemplate(buf);
    const cleanName = name.replace(/\.pptx$/i, "");
    const prompt = remakeSystemPrompt(masterToLayoutInventory(source));
    let aiRaw: string | null = null;
    try {
      aiRaw = await callAI(prompt);
    } catch {
      aiRaw = null; // AI failure → deterministic fallback below (never worse)
    }
    const logo = await extractLogo(source);
    const { spec, usedAi, note } = aiRemakeSpec(source, aiRaw, {
      name: i18n.t("applyTemplate.remakeName", { name: cleanName }),
      logo,
    });
    const remadeBytes = await writeTemplate(spec);
    const remade = await loadTemplate(remadeBytes);
    const health = assessTemplateHealth(buildCatalog(remade));
    if (health.status === "rejected") {
      setters.setParseError(i18n.t("applyTemplate.remakeFailedValidation"));
      return { ok: false, health };
    }
    setters.setTemplateData(remade);
    setters.setTemplateName(spec.name);
    return { ok: true, health, remadeBytes, usedAi, note };
  } catch (err) {
    setters.setParseError(
      i18n.t("applyTemplate.remakeFailed", { error: err instanceof Error ? err.message : String(err) }),
    );
    return { ok: false };
  }
}

/** 修復プランを確認ダイアログ向けの短い日本語に要約する（純粋・UI 非依存）。 */
export function describeRepairPlan(plan: RepairPlan): string {
  const blocks = plan.health.findings.filter((f) => f.level === "block").map((f) => f.message);
  const titles = plan.ops.filter((o) => o.setType === "title").length;
  const bodies = plan.ops.filter((o) => o.setType === "body").length;
  const parts = [
    titles > 0 ? i18n.t("applyTemplate.repairTitleFrames", { n: titles }) : "",
    bodies > 0 ? i18n.t("applyTemplate.repairBodyFrames", { n: bodies }) : "",
  ].filter(Boolean).join(i18n.t("applyTemplate.repairPartSeparator"));
  return (
    i18n.t("applyTemplate.repairPlanHeader", { blocks: blocks.join("\n") }) +
    i18n.t("applyTemplate.repairPlanProposal", { total: plan.ops.length, parts }) +
    i18n.t("applyTemplate.repairPlanConfirm")
  );
}
