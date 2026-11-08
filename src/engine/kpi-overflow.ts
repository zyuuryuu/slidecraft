/**
 * kpi-overflow.ts — #643: a KPI value (the big number) that will not stay on ONE line of its value box.
 *
 * The value box is meant to show the number on a single line; once it wraps ("−18 / %"), it collides with
 * the label or note below. Neither body-overflow (body box capacity) nor title-overflow (title box) looked at
 * that box, so get_deck_issues stayed silent. This module only DIAGNOSES (no shrinking — a separate decision).
 *
 * Every input is read from the path export already uses (R8, no second judgment):
 *   - which box is the value box → group-layout's kpiValueSlot (the same judgment as markKpiValue / #638)
 *   - what text lands in it      → the observed BindingPlan (slideBindingPlan → expandGroups' assignments)
 *   - how wide that text is      → title-fit's measureLines (draw-target's wrapToWidth, 0.1in inset)
 * Pure logic (R2): no DOM / Tauri.
 */
import type { SlideIR, PlaceholderContent } from "./slide-schema";
import type { LayoutInfo, PlaceholderInfo } from "./template-loader";
import type { BindingPlan } from "./placeholder-binding";
import { isGroupedSlide } from "./slide-markers";
import { detectGroups, kpiValueSlot } from "./group-layout";
import { measureLines } from "./title-fit";

export interface KpiValueOverflow {
  /** The value box the text is bound to. */
  placeholder: PlaceholderInfo;
  /** The value text as bound (paragraphs joined by " / "). */
  text: string;
  /** The box's font size (pt) and the estimated line count at it (> paragraph count ⇒ it wraps). */
  fontPt: number;
  lines: number;
}

const textOf = (c: PlaceholderContent) => c.paragraphs.map((p) => p.segments.map((s) => s.text).join("")).join(" / ");

/** The KPI value boxes on this slide whose bound value wraps past one line per paragraph. Empty for a
 *  non-grouped slide, a non-kpi layout, or a value that fits — so healthy decks get no new issue. */
export function kpiValueOverflows(slide: SlideIR, layout: LayoutInfo, plan: BindingPlan): KpiValueOverflow[] {
  if (!isGroupedSlide(slide)) return []; // the same gate as slideBindingPlan's group branch
  const shape = detectGroups(layout);
  if (!shape || shape.kind !== "kpi") return [];
  const out: KpiValueOverflow[] = [];
  for (const group of shape.groups) {
    const slot = kpiValueSlot(shape, group, layout);
    const ph = slot && layout.placeholders.find((p) => p.idx === slot.phIdx);
    const content = ph && plan.assignments.find((a) => a.placeholder.idx === ph.idx)?.content.content;
    if (!ph || !content || ph.style.fontSize <= 0 || !textOf(content).trim()) continue;
    const { lines } = measureLines(content.paragraphs, ph.style, ph.style.fontSize);
    if (lines > content.paragraphs.length) out.push({ placeholder: ph, text: textOf(content), fontPt: ph.style.fontSize, lines });
  }
  return out;
}
