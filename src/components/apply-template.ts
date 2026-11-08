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
import { masterToTemplateSpec, extractLogo, logoForDarkLayouts } from "../engine/master-remake";
import { faithfulRemake } from "../engine/faithful-remake";
import { writeTemplate } from "../engine/template-writer";
import { augmentAndVerify } from "../engine/layout-augment";
import type { AugmentPlan, AugmentOptions } from "../engine/layout-augment-plan";
import type { AugmentStructure } from "../engine/layout-augment-structures";
import { adjustTemplate, type TemplateAdjustRecipe } from "../engine/template-adjust";

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
  added?: string[]; // #568 augment: names of the synthesized layouts
}

/** Progress ticks emitted DURING a (possibly slow) intake so the UI can show a live indicator. */
export type IntakeProgress =
  | { phase: "loading" }
  | { phase: "generating"; step: number; total: number } // AI best-of-N candidate i/n
  | { phase: "composing" }
  | { phase: "validating" };

/**
 * Coarse monotonic fraction so the progress bar reads as real progress. AI best-of-N dominates the
 * wall-clock, so the generating phase spans the bulk (10→85%); the fast pre/post phases bracket it.
 *
 * Lives HERE (next to IntakeProgress) rather than in IntakeSummaryBar.tsx: a component module may only
 * export components, or React Fast Refresh silently stops working for the file
 * (eslint react-refresh/only-export-components — it had CI lint red).
 */
export function phaseFraction(p: IntakeProgress): number {
  switch (p.phase) {
    case "loading": return 0.06;
    case "generating": return 0.1 + 0.75 * (p.step / Math.max(1, p.total));
    case "composing": return 0.9;
    case "validating": return 0.97;
  }
}

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
    // lift the source's logo onto the minted dark layouts — the variant drawn on DARK backgrounds (#118)
    const logo = logoForDarkLayouts(await extractLogo(source));
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


export interface AdjustResult extends ApplyTemplateResult {
  adjustedBytes?: Uint8Array; // the derived template — register THESE bytes (the source stays as it was)
}

/**
 * テンプレ調整（#570 段 2）: 元テンプレ bytes にレシピ（書体置換 → サイズ倍率）を掛けた**派生**を、faithful
 * Re-make と同じゲート（loadTemplate → assessTemplateHealth）で適用する。元 bytes は書き換えない。GUI は
 * スライダを動かすたびに「元テンプレ＋レシピ」からこれを呼び直す（調整の上塗りをしない）。
 */
export async function applyTemplateBytesAsAdjusted(
  source: ArrayBuffer | Uint8Array,
  recipe: TemplateAdjustRecipe,
  name: string,
  setters: TemplateSetters,
): Promise<AdjustResult> {
  try {
    const adjustedBytes = await adjustTemplate(source, recipe);
    const adjusted = await loadTemplate(adjustedBytes);
    const health = assessTemplateHealth(buildCatalog(adjusted));
    if (health.status === "rejected") {
      setters.setParseError(i18n.t("applyTemplate.remakeFailedValidation"));
      return { ok: false, health };
    }
    setters.setTemplateData(adjusted);
    setters.setTemplateName(name);
    return {
      ok: true,
      health,
      adjustedBytes,
      summary: { layoutCount: adjusted.layouts.length, status: health.status, findings: health.findings.map((f) => f.message) },
    };
  } catch (err) {
    setters.setParseError(i18n.t("templateAdjust.failed", { error: err instanceof Error ? err.message : String(err) }));
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

export interface AugmentApplyResult extends ApplyTemplateResult {
  augmentedBytes?: Uint8Array; // the augmented template — register THESE bytes (the source stays untouched)
  reason?: string; // why nothing was applied (nothing missing / no base layout / gate failure)
}

/**
 * #568 段 2「テンプレを強化」: そのテンプレに無い N 列レイアウトを合成して足し（layout-augment.ts）、
 * 検査ゲートに通った派生 bytes を faithful Re-make と同じ形で適用する。元の bytes は書き換えない。
 * 足すものが無い・元にできない・ゲート不合格のときは適用せず reason を返す（never-silent）。
 */
export async function applyTemplateBytesAsAugmented(
  buf: ArrayBuffer | Uint8Array,
  name: string,
  setters: TemplateSetters,
  opts: AugmentOptions = {},
): Promise<AugmentApplyResult> {
  try {
    const r = await augmentAndVerify(buf, opts);
    if (!r.applied) {
      const reason = r.failures.length > 0
        ? i18n.t("applyTemplate.augmentFailed", { reason: r.failures.join(" / ") })
        : (r.reason ?? r.plan.skipped.map((x) => x.reason).join(" "));
      return { ok: false, reason };
    }
    const augmented = await loadTemplate(r.bytes);
    const health = assessTemplateHealth(buildCatalog(augmented));
    if (health.status === "rejected") return { ok: false, health, reason: i18n.t("applyTemplate.augmentFailed", { reason: health.status }) };
    setters.setTemplateData(augmented);
    setters.setTemplateName(name.replace(/\.pptx$/i, "") + i18n.t("app.augmentSuffix"));
    return {
      ok: true,
      health,
      augmentedBytes: r.bytes,
      summary: { layoutCount: augmented.layouts.length, status: health.status, findings: health.findings.map((f) => f.message), added: r.added.map((a) => a.name) },
    };
  } catch (err) {
    setters.setParseError(i18n.t("applyTemplate.augmentFailed", { reason: err instanceof Error ? err.message : String(err) }));
    return { ok: false };
  }
}

/** 強化の確認文（describeRepairPlan と同じ形・純粋・UI 非依存）。 */
export function describeAugmentPlan(plan: AugmentPlan): string {
  const sep = i18n.t("applyTemplate.repairPartSeparator");
  const from = plan.base?.sourceSizes[0];
  const label = (s: AugmentStructure) => augmentStructureLabel(s);
  // #568 段 3: never-silent list — what is added (with its sizes) and what is NOT added because it exists.
  const present = plan.skipped.filter((x) => x.reason !== plan.reason).map((x) => label(x.structure));
  return i18n.t("applyTemplate.augmentPlan", {
    what: plan.add.map((a) => label(a.structure)).join(sep),
    base: plan.base?.layoutName ?? "",
    sizes: plan.add
      .map((a) => a.group
        ? i18n.t("applyTemplate.augmentSizeGroup", { label: label(a.structure), from, to: a.levelSizes[0], head: a.group.headSize })
        : i18n.t("applyTemplate.augmentSize", { label: label(a.structure), from, to: a.levelSizes[0] }))
      .join(sep),
    skipped: present.length > 0 ? i18n.t("applyTemplate.augmentPlanSkipped", { list: present.join(sep) }) : "",
  });
}

/** 構造の表示名（i18n）。ボタンと確認文で共用。 */
export function augmentStructureLabel(s: AugmentStructure): string {
  return i18n.t(`applyTemplate.augmentStructure.${s}`);
}
