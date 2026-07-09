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
import { faithfulRemake } from "../engine/faithful-remake";
import { writeTemplate } from "../engine/template-writer";

export interface TemplateSetters {
  setTemplateData: (t: TemplateData) => void;
  setTemplateName: (n: string) => void;
  setParseError: (e: string | null) => void;
}

/**
 * "What happened" summary of an intake, for the transparency bar (docs/design/ai-remake.md §9.2 →
 * generalised to all three intake modes). Built by each apply function from data it already computes.
 */
export interface IntakeSummary {
  layoutCount: number; // resulting layouts in the active template
  status: TemplateHealth["status"]; // ok | degraded | rejected
  findings: string[]; // health finding messages (warnings the user should see)
  theme?: { major: string; minor: string; palette: string[]; logo: boolean }; // Re-make modes (hex WITH #)
  repairs?: number; // faithful-Import repair path: how many placeholder frames were repaired
}

/** Progress ticks emitted DURING a (possibly slow) intake so the UI can show a live indicator. */
export type IntakeProgress =
  | { phase: "loading" }
  | { phase: "generating"; step: number; total: number } // AI best-of-N candidate i/n
  | { phase: "composing" }
  | { phase: "validating" };

function themeSummary(
  spec: { fonts: { major: string; minor: string; majorEa?: string; minorEa?: string }; palette: Record<string, string> },
  logo: boolean,
) {
  // Show the VISIBLE typeface: for a Japanese master that's the East-Asian (ea) font (the brand font),
  // with the Latin pairing as a fallback. So a 游ゴシック deck reads "游ゴシック", not "Century Gothic".
  return {
    major: spec.fonts.majorEa || spec.fonts.major,
    minor: spec.fonts.minorEa || spec.fonts.minor,
    palette: Object.values(spec.palette).map((h) => (h.startsWith("#") ? h : `#${h}`)),
    logo,
  };
}

export interface ApplyTemplateResult {
  ok: boolean;
  health?: TemplateHealth; // present whenever the bytes parsed (even if rejected), for the caller to surface
  repair?: RepairPlan; // rejected 時の修復プラン（repairable でも同意が得られなかった場合も返す）
  repairedBytes?: Uint8Array; // 修復を適用したときの登録用 bytes（レジストリにはこちらを保存する）
  summary?: IntakeSummary; // "what happened" for the transparency bar (present when ok)
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
      return {
        ok: true,
        health,
        summary: { layoutCount: tpl.layouts.length, status: health.status, findings: health.findings.map((f) => f.message), repairs: 0 },
      };
    }

    const plan = planRepairs(tpl);
    if (plan.repairable && (await confirmRepair(plan))) {
      const r = await repairTemplate(buf);
      if (r.healthAfter.status !== "rejected") {
        const repaired = await loadTemplate(r.bytes);
        setters.setTemplateData(repaired);
        setters.setTemplateName(name.replace(/\.pptx$/i, ""));
        return {
          ok: true,
          health: r.healthAfter,
          repair: plan,
          repairedBytes: r.bytes,
          summary: { layoutCount: repaired.layouts.length, status: r.healthAfter.status, findings: r.healthAfter.findings.map((f) => f.message), repairs: plan.ops.length },
        };
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
    return {
      ok: true,
      health,
      remadeBytes,
      summary: { layoutCount: remade.layouts.length, status: health.status, findings: health.findings.map((f) => f.message), theme: themeSummary(spec, !!logo) },
    };
  } catch (err) {
    setters.setParseError(
      i18n.t("applyTemplate.remakeFailed", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false };
  }
}

/**
 * Faithful Re-make (ADR-0027): keep the source's VISUAL layer (decorations / geometry / backgrounds /
 * images) byte-intact and normalise only the theme fonts — so the brand design (e.g. the 公文書
 * master's 85 decorations) SURVIVES, unlike applyTemplateBytesAsRemake which rebuilds on canonical
 * layouts and drops it. Applied through the same health gate; placeholder roles bind via the loader
 * (same as faithful Import), which is why geometry preservation is safe.
 */
export async function applyTemplateBytesAsFaithfulRemake(
  buf: ArrayBuffer | Uint8Array,
  name: string,
  setters: TemplateSetters,
): Promise<RemakeResult> {
  try {
    const { bytes, fonts } = await faithfulRemake(buf);
    const remade = await loadTemplate(bytes);
    const health = assessTemplateHealth(buildCatalog(remade));
    if (health.status === "rejected") {
      setters.setParseError(i18n.t("applyTemplate.remakeFailedValidation"));
      return { ok: false, health };
    }
    setters.setTemplateData(remade);
    setters.setTemplateName(i18n.t("applyTemplate.remakeName", { name: name.replace(/\.pptx$/i, "") }));
    const hasLogo = remade.masterImages.length > 0 || remade.layouts.some((l) => l.images.length > 0);
    return {
      ok: true,
      health,
      remadeBytes: bytes,
      summary: {
        layoutCount: remade.layouts.length,
        status: health.status,
        findings: health.findings.map((f) => f.message),
        // Show the VISIBLE font (ea over latin) + the source's own brand colors (faithful keeps them).
        theme: {
          major: fonts.majorEa || fonts.majorLatin,
          minor: fonts.minorEa || fonts.minorLatin,
          palette: Object.values(remade.themeColors).map((h) => (h.startsWith("#") ? h : `#${h}`)),
          logo: hasLogo,
        },
      },
    };
  } catch (err) {
    setters.setParseError(i18n.t("applyTemplate.remakeFailed", { error: err instanceof Error ? err.message : String(err) }));
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
