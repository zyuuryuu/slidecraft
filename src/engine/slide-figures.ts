/**
 * slide-figures.ts — #392: the ONE reader of "which body visuals does this slide have, in what order" (R8).
 *
 * A slide stores its visuals two ways during the #392 migration:
 * - the singular fields (`diagram` / `mermaidBlock` / `table` / `code` / `image`) — the FIRST visual of
 *   each kind. Every renderer and editor still reads these (段 2/3 move them to the list).
 * - `figures` — ALL body visuals in source order, present only when the slide has ≥2 (md-slide-parser).
 *
 * slideFigures merges the two so they can never disagree: the singular field is authoritative for the
 * first visual of its kind (an editor that rewrites `slide.diagram` — set_slide_diagram, applyFigureYaml —
 * is seen here), `figures` supplies the order and the 2nd+ ones. A behind image is a backmost LAYER, not a
 * body visual, so it is never in the list (it serializes separately, md-serializer).
 *
 * Pure logic (R2).
 */
import type { SlideIR, FigureBlock, FigureKind } from "./slide-schema";

/** Kind order used when a slide has no `figures` — the historical single-figure priority
 *  (md-serializer-shared's old figureBlock order), so a figures-less slide reads as before. */
const KIND_ORDER: readonly FigureKind[] = ["table", "diagram", "mermaid", "code", "image"];

/** The singular field of `kind` as a FigureBlock, or undefined (a behind image is not a body visual). */
function singular(slide: SlideIR, kind: FigureKind): FigureBlock | undefined {
  switch (kind) {
    case "table": return slide.table && { kind, ...slide.table };
    case "diagram": return slide.diagram && { kind, ...slide.diagram };
    case "mermaid": return slide.mermaidBlock && { kind, ...slide.mermaidBlock };
    case "code": return slide.code && { kind, ...slide.code };
    case "image": return slide.image && !slide.image.behind ? { kind, ...slide.image } : undefined;
  }
}

/** Every body visual of the slide, in source order (see module doc). */
export function slideFigures(slide: SlideIR): FigureBlock[] {
  const singles = KIND_ORDER.flatMap((k) => singular(slide, k) ?? []);
  if (!slide.figures) return singles;
  const out: FigureBlock[] = [];
  const seen = new Set<FigureKind>();
  for (const f of slide.figures) {
    if (seen.has(f.kind)) {
      out.push(f);
      continue;
    }
    seen.add(f.kind);
    const s = singular(slide, f.kind); // the first of its kind = the singular field (removed → dropped)
    if (s) out.push(s);
  }
  for (const s of singles) if (!seen.has(s.kind)) out.push(s); // a singular added after parse
  return out;
}

/** User-facing name of each kind (diagnostic messages). */
export const FIGURE_KIND_LABEL: Record<FigureKind, string> = { diagram: "図", mermaid: "Mermaid 図", table: "表", code: "コード", image: "画像" };

/** The visuals the renderers do not draw yet: every one that is not a singular field (the 2nd+ of a
 *  kind). Until #392 段 2 places them, deck-diagnostics reports these (never-silent). */
export function undrawnFigures(slide: SlideIR): FigureBlock[] {
  const seen = new Set<FigureKind>();
  return slideFigures(slide).filter((f) => {
    if (seen.has(f.kind)) return true;
    seen.add(f.kind);
    return false;
  });
}

/** A figure without its `kind` tag = the singular block it came from (field order kept). */
function untag<T extends FigureBlock>(f: T): Omit<T, "kind"> {
  const b: Partial<T> = { ...f };
  delete b.kind;
  return b as Omit<T, "kind">;
}

/** The singular fields for an ordered visual list: the first of each kind (kind tag stripped), plus
 *  `figures` itself when there are ≥2 — the inverse of slideFigures, used by md-slide-parser. */
export function figureFields(list: readonly FigureBlock[]): Pick<SlideIR, "diagram" | "mermaidBlock" | "table" | "code" | "image" | "figures"> {
  const out: ReturnType<typeof figureFields> = {};
  for (const f of list) {
    if (f.kind === "diagram") out.diagram ??= untag(f);
    else if (f.kind === "mermaid") out.mermaidBlock ??= untag(f);
    else if (f.kind === "table") out.table ??= untag(f);
    else if (f.kind === "code") out.code ??= untag(f);
    else out.image ??= untag(f);
  }
  if (list.length >= 2) out.figures = [...list];
  return out;
}
