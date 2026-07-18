/**
 * group-binding.ts — the SEPARATE grouped-layout FILL path (card / step / kpi / compare).
 * Design: docs/design/grouped-layout-binding.md.
 *
 * Geometric DETECTION lives in ./group-layout (type-only deps, so template-catalog can import it
 * without a runtime cycle). This module adds the BINDING (expandGroups), which value-imports
 * bindContentByRole. It NEVER modifies slideIdxRole / placeholderRole / buildFieldMap, and only fires
 * when slide.groupKind is set AND the layout is grouped — non-grouped slides go through
 * bindContentByRole exactly as before (ADR-0011 1:1 preserved). Pure logic (R2).
 */
import type { LayoutInfo, PlaceholderInfo } from "./template-loader";
import type { SlideIR, PlaceholderContent, Paragraph } from "./slide-schema";
import { bindContentByRole, resolveBinding, isBlankParagraphs, type BindingPlan, type ContentRef, type PlaceholderRef } from "./placeholder-binding";
import { slideIdxRole, placeholderRole } from "./template-catalog";
import { detectGroups, bakedText } from "./group-layout";

export { detectGroups, isGroupedLayout } from "./group-layout";
export type { GroupSlot, GroupSlotRole, GroupLayoutShape } from "./group-layout";

/**
 * Editor plan for a grouped slide: the META placeholders (title/date/… — still edited via buildFieldMap)
 * and the layout's column count. The editor shows one GROUP field (content idx 1..N) per column instead
 * of buildFieldMap over the per-group cells. Null when the slide isn't grouped or the layout isn't a
 * group layout → the editor keeps its normal buildFieldMap path (1:1 untouched).
 */
export function groupEditorPlan(slide: SlideIR, layout: LayoutInfo): { metaPhs: PlaceholderInfo[]; columns: number } | null {
  const shape = detectGroups(layout);
  if (!shape || !slide.groupKind) return null;
  const groupPhIdxs = new Set(shape.groups.flat().map((s) => s.phIdx));
  return { metaPhs: layout.placeholders.filter((p) => !groupPhIdxs.has(p.idx)), columns: shape.groups.length };
}

/**
 * Fill a grouped layout from a Slice-A SlideIR (groupKind + placeholders idx 1..N, each = [heading] +
 * body paras). Returns the SAME Map<layoutPhIdx, PlaceholderContent> shape as bindContentByRole, so the
 * preview + export loops consume it unchanged. Empty when the slide isn't grouped or the layout isn't a
 * group layout (the caller falls back to bindContentByRole).
 *
 * CRITICAL (1:1 non-breakage): title/subtitle/meta are bound by calling bindContentByRole on a
 * NON-GROUP subset (group content idx 1-9 removed, group placeholders removed) — so the canonical binder
 * never encounters a group cell (idx13-24) nor group content, and runs byte-identical.
 */
export function expandGroups(slide: SlideIR, layout: LayoutInfo): Map<string, PlaceholderContent> {
  const out = new Map<string, PlaceholderContent>();
  const shape = detectGroups(layout);
  if (!shape || !slide.groupKind) return out;

  const isGroupIdx = (i: string) => /^[1-9]$/.test(i);
  const groupPhIdxs = new Set(shape.groups.flat().map((s) => s.phIdx));

  // (a) title/subtitle/meta — bindContentByRole on the non-group subset (byte-identical canonical path).
  const metaSlide: SlideIR = { ...slide, placeholders: slide.placeholders.filter((c) => !isGroupIdx(c.idx)) };
  const metaLayoutPhs = layout.placeholders.filter((p) => !groupPhIdxs.has(p.idx));
  for (const [k, v] of bindContentByRole(metaSlide, metaLayoutPhs)) out.set(k, v);

  // (b) group content idx 1..N → column slots (heading / body / chrome).
  const contentGroups = slide.placeholders.filter((c) => isGroupIdx(c.idx)).sort((a, b) => parseInt(a.idx) - parseInt(b.idx));
  const phByIdx = new Map(layout.placeholders.map((p) => [p.idx, p] as const));
  const n = Math.min(shape.groups.length, contentGroups.length); // overflow → extras dropped (decision ②)
  for (let i = 0; i < n; i++) {
    const col = shape.groups[i];
    const c = contentGroups[i];
    const headParas = c.paragraphs.filter((p) => p.heading);
    const bodyParas = c.paragraphs.filter((p) => !p.heading);
    const headSlot = col.find((s) => s.role === "heading");
    const bodySlots = col.filter((s) => s.role === "body");
    const chromeSlot = col.find((s) => s.role === "chrome");

    if (headSlot && headParas.length)
      out.set(headSlot.phIdx, { idx: headSlot.phIdx, paragraphs: headParas.map((p) => ({ ...p, heading: false })) });

    if (bodySlots.length === 1) {
      if (bodyParas.length) out.set(bodySlots[0].phIdx, { idx: bodySlots[0].phIdx, paragraphs: bodyParas });
    } else if (bodySlots.length >= 2) {
      // KPI: para0 → 数値枠, para1.. → 補足枠 (fill each slot, spilling extras into the last).
      const buckets: Paragraph[][] = bodySlots.map(() => []);
      bodyParas.forEach((p, j) => buckets[Math.min(j, buckets.length - 1)].push(p));
      bodySlots.forEach((s, j) => { if (buckets[j].length) out.set(s.phIdx, { idx: s.phIdx, paragraphs: buckets[j] }); });
    }

    // chrome number → EDITABLE slide content (decision ③), preserving the baked format's number
    // ("1"→"i+1", "STEP 1"→"STEP i+1"). Empty groups get no chrome → clean.
    if (chromeSlot) {
      const baked = bakedText(phByIdx.get(chromeSlot.phIdx)?.shapeXml ?? "");
      const num = String(i + 1);
      const text = /\d/.test(baked) ? baked.replace(/\d+/, num) : num;
      out.set(chromeSlot.phIdx, { idx: chromeSlot.phIdx, paragraphs: [{ segments: [{ text }] }] });
    }
    // picture slots: no entry → inherited (a Markdown deck can't fill an image).
  }
  return out;
}

/**
 * ADR-0030 (BindingPlan) — the single OBSERVED binding plan for one slide on its resolved layout, using
 * the EXACT dispatch the export + preview use (placeholder-filler:145 / SlidePreview:199): a grouped slide
 * on a group layout fills via expandGroups, everything else via bindContentByRole. Lifting that same branch
 * into a BindingPlan lets the diagnostic layer warn on `unbound` instead of dropping silently — and because
 * it reuses the very functions export runs, the warn matches what would actually vanish.
 *
 * Non-group layout → delegate to resolveBinding (pure composition of the primitives). Group layout → MIRROR
 * expandGroups' result into the envelope (integration deferred to stage E): `assignments` come verbatim from
 * expandGroups, and `unbound` = the group content the column cap dropped (decision ②: groups beyond the
 * layout's column count) PLUS any meta content expandGroups left unplaced. Group cells are transformed
 * copies, so identity can't judge them — the column cap does; meta content stays by-reference, so identity
 * judges it. Pure (R2).
 */
export function slideBindingPlan(slide: SlideIR, layout: LayoutInfo): BindingPlan {
  const shape = detectGroups(layout);
  if (!slide.groupKind || !shape) return resolveBinding(slide, layout.placeholders);

  const bound = expandGroups(slide, layout);
  const hasCtrTitle = layout.placeholders.some((p) => p.type.toLowerCase().includes("ctrtitle"));
  const isGroupIdx = (i: string) => /^[1-9]$/.test(i);
  const groupContents = slide.placeholders.filter((c) => isGroupIdx(c.idx)).sort((a, b) => parseInt(a.idx) - parseInt(b.idx));
  const kept = Math.min(shape.groups.length, groupContents.length);
  const dropped = new Set(groupContents.slice(kept)); // decision ②: extra groups have no column → dropped
  const placed = new Set(bound.values()); // meta content is bound by reference (originals)

  const phRoleByIdx = new Map(layout.placeholders.map((p) => [p.idx, placeholderRole(p)] as const));
  const contentRef = (c: PlaceholderContent): ContentRef => ({ idx: c.idx, role: slideIdxRole(c.idx, hasCtrTitle), content: c });
  const phRef = (idx: string): PlaceholderRef => ({ idx, role: phRoleByIdx.get(idx) ?? "other" });

  const assignments = [...bound.entries()].map(([phIdx, content]) => ({ content: contentRef(content), placeholder: phRef(phIdx) }));
  // A content item is unbound iff non-blank AND (a group content that overflowed its columns, OR a meta
  // content expandGroups did not place). Group cells can't be judged by identity (they are copies).
  const unbound = slide.placeholders
    .filter((c) => !isBlankParagraphs(c.paragraphs) && (isGroupIdx(c.idx) ? dropped.has(c) : !placed.has(c)))
    .map(contentRef);
  const filled = new Set(bound.keys());
  const unfilled = layout.placeholders.filter((p) => !filled.has(p.idx) && placeholderRole(p) !== "slideNumber").map((p) => phRef(p.idx));
  return { assignments, unbound, unfilled };
}
