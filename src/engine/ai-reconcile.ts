/**
 * ai-reconcile.ts — the deterministic "harness over model" guard for AI slide edits.
 *
 * A ~3B (and sometimes a frontier) model editing ONE slide occasionally drops the structural
 * scaffolding it was only asked to leave alone: the `<!-- slide: Layout -->` header, the `# Title`,
 * the `Category/Date/Footer` meta, the `<!-- card/step/kpi -->` group hint, or an embedded
 * figure. Because every apply path replaces the slide with parseMd(edited).slides[0], a dropped
 * element is lost deterministically. reconcileEdit restores those from the PREVIOUS slide while
 * respecting anything the edit explicitly kept (respect-if-present) — so the final invariant lives
 * in the harness, not in the model's compliance. See docs (decisions A2 / D1).
 *
 * 1:1 non-breakage (ADR-0011): placeholders are merged by idx through a Map, so a restored idx can
 * never duplicate an edited one — buildFieldMap stays injective. Pure logic (R2): SlideIR in → out.
 */

import type { SlideIR, PlaceholderContent } from "./slide-schema";
import { titleSubtitleIdx, META_IDXS } from "./slide-roles";

/** True when a placeholder carries any non-whitespace text. */
export function hasText(ph: PlaceholderContent | undefined): boolean {
  return !!ph && ph.paragraphs.some((p) => p.segments.some((s) => s.text.trim().length > 0));
}

/** True when the slide carries ANY content — placeholder text or an embedded figure. */
function hasAnyContent(s: SlideIR): boolean {
  return s.placeholders.some((p) => hasText(p)) || !!s.diagram || !!s.mermaidBlock || !!s.table || !!s.code;
}

/**
 * Restore the structural scaffolding an AI edit dropped, from the previous slide.
 *
 * Order matters: restore the LAYOUT pin first, then interpret title/subtitle idx under the restored
 * layout (idx 0/1 for title layouts, 15/16 otherwise). Respect-if-present: a structural field the
 * edit KEPT (non-empty) is never overwritten; only a dropped/empty one is restored. Body content is
 * always the edit's to change. A fully-empty edit is treated as a failed edit → old is kept wholesale.
 */
export function reconcileEdit(old: SlideIR, edited: SlideIR): SlideIR {
  // Meltdown guard: an edit with no content at all is a failed edit, not an intentional clear.
  if (!hasAnyContent(edited)) return old;

  // ① layout — a dropped header (edited.layout === "auto") re-selects the layout; restore old's pin.
  //    An explicit re-pin is the edit's structural intent → respect it.
  const layout = edited.layout === "auto" && old.layout !== "auto" ? old.layout : edited.layout;

  // ② title / subtitle / meta — restore per-idx (interpreted under the RESTORED layout) when the edit
  //    dropped/emptied them. The title namespace mirrors the PARSER exactly: a slide is title-namespace
  //    when its layout is Title/Closing OR it carries meta fields — so we judge it from OLD's meta
  //    presence (the authoritative prior structure), not the layout name alone. Merge through a Map
  //    keyed by idx → never a duplicate idx (injective, ADR-0011).
  const oldHasMeta = META_IDXS.some((idx) => hasText(old.placeholders.find((p) => p.idx === idx)));
  const { title, subtitle } = titleSubtitleIdx(layout, oldHasMeta);
  const structuralIdxs = [title, subtitle, ...META_IDXS];
  const byIdx = new Map<string, PlaceholderContent>(edited.placeholders.map((p) => [p.idx, p]));
  for (const idx of structuralIdxs) {
    if (hasText(byIdx.get(idx))) continue; // edit kept it → respect
    const restored = old.placeholders.find((p) => p.idx === idx);
    if (hasText(restored)) byIdx.set(idx, restored!); // edit dropped it → restore old's
  }

  return {
    ...edited,
    layout,
    placeholders: [...byIdx.values()],
    // Figures: respect an edited figure, else carry the old one (matches the pre-existing
    // diagram/mermaid carry in handleApplySlide, generalized to table/code).
    diagram: edited.diagram ?? old.diagram,
    mermaidBlock: edited.mermaidBlock ?? old.mermaidBlock,
    table: edited.table ?? old.table,
    code: edited.code ?? old.code,
    // groupKind rides the SAME signal as the layout pin: if the header was dropped (layout auto),
    // the group hint was almost certainly dropped with it → restore. If the edit re-pinned a concrete
    // layout, respect its structural choice and don't force the slide back into a group.
    groupKind: edited.groupKind ?? (edited.layout === "auto" ? old.groupKind : undefined),
    sourceLineStart: edited.sourceLineStart ?? old.sourceLineStart,
    sourceLineEnd: edited.sourceLineEnd ?? old.sourceLineEnd,
  };
}
