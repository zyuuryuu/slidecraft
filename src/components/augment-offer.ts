/**
 * augment-offer.ts — #612: what 「テンプレを強化」 would add to a template, as ONE function shared by the
 * master menu (the action) and the intake bar (the hint). One path, so the hint and the menu can't
 * disagree (R8). Read-only: the plan is computed here; the augment itself stays in apply-template.
 */
import i18n from "../i18n";
import type { TemplateData } from "../engine/template-loader";
import { buildCatalog } from "../engine/template-catalog";
import { planAugmentation, type AugmentPlan } from "../engine/layout-augment-plan";
import { ALL_AUGMENT_STRUCTURES } from "../engine/layout-augment-structures";
import { augmentStructureLabel } from "./apply-template";

/** #568 段 3: 「無い構造を全部足す」— N 列・比較・カード 3・KPI 3/4 のうちテンプレに無いもの。 */
export function planTemplateAugmentation(template: TemplateData): AugmentPlan {
  return planAugmentation(template, buildCatalog(template), { structures: ALL_AUGMENT_STRUCTURES });
}

/** The structures the plan adds, as one display string (e.g. 「3 列・KPI 4 個」). */
export function augmentWhat(plan: AugmentPlan): string {
  return plan.add.map((a) => augmentStructureLabel(a.structure)).join(i18n.t("applyTemplate.repairPartSeparator"));
}
