/**
 * placeholder-binding.ts — bind a slide's content to a layout's placeholders BY ROLE (not idx).
 *
 * THE single source of truth for "which content goes in which placeholder", shared by the PPTX
 * export (placeholder-filler.buildSlideXml) AND the live preview (SlidePreview.SlideCard) so they
 * can NEVER diverge — WYSIWYG. Binding by role (via slideIdxRole/placeholderRole) is what makes an
 * ALIEN master work: the SlideIR uses canonical idxs (15=title, 1=body…) but any template's own
 * placeholder idxs bind correctly through their shared ROLE. (The old preview keyed content by
 * literal idx, so an alien master rendered blank even though the export bound it fine.)
 *
 * Pure logic (R2): no DOM / Tauri.
 */
import type { SlideIR, PlaceholderContent } from "./slide-schema";
import type { PlaceholderInfo } from "./template-loader";
import { slideIdxRole, placeholderRole, type PlaceholderRole } from "./template-catalog";

/** Stable placeholder order: shorter idx first, then lexicographic (so 1 < 2 < 10 < 15). */
export function sortByIdx<T extends { idx: string }>(a: T, b: T): number {
  return a.idx.length - b.idx.length || a.idx.localeCompare(b.idx);
}

/**
 * Map each LAYOUT placeholder idx → the SlideIR content that belongs in it, matched by ROLE (with
 * order for repeated roles, e.g. columns → body#1, body#2). Any template's idx convention binds
 * correctly. Returns only placeholders that received content.
 */
export function bindContentByRole(
  slide: SlideIR,
  layoutPlaceholders: readonly PlaceholderInfo[],
): Map<string, PlaceholderContent> {
  const hasCtrTitle = slide.placeholders.some((p) => p.idx === "0");
  const contentByRole = new Map<PlaceholderRole, PlaceholderContent[]>();
  for (const c of [...slide.placeholders].sort(sortByIdx)) {
    const role = slideIdxRole(c.idx, hasCtrTitle);
    const list = contentByRole.get(role);
    if (list) list.push(c);
    else contentByRole.set(role, [c]);
  }

  const out = new Map<string, PlaceholderContent>();
  const roleSeen: Record<string, number> = {};
  for (const lph of [...layoutPlaceholders].sort(sortByIdx)) {
    const role = placeholderRole(lph);
    roleSeen[role] = (roleSeen[role] ?? 0) + 1;
    const content = contentByRole.get(role)?.[roleSeen[role] - 1];
    if (content) out.set(lph.idx, content);
  }
  return out;
}

/** The layout's BODY placeholders in stable order — a figure/table rides the Nth of these. */
export function bodyPlaceholders(layoutPlaceholders: readonly PlaceholderInfo[]): PlaceholderInfo[] {
  return [...layoutPlaceholders].sort(sortByIdx).filter((p) => placeholderRole(p) === "body");
}

/** The BODY placeholder a visual targets: placeholderIdx "1"→1st body, "2"→2nd, … (1-based). */
export function nthBody(bodyPhs: readonly PlaceholderInfo[], placeholderIdx?: string): PlaceholderInfo | undefined {
  if (!placeholderIdx) return undefined;
  return bodyPhs[Math.max(1, parseInt(placeholderIdx) || 1) - 1];
}
