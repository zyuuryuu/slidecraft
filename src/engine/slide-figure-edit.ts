/**
 * slide-figure-edit.ts — #392 段 3: the ONE writer of a slide's body-visual list (R8).
 *
 * The reader is slide-figures.slideFigures: the singular field (`diagram` / `mermaidBlock` / `table` /
 * `code` / `image`) is authoritative for the FIRST visual of its kind, `figures` gives the order and the
 * 2nd+ ones, and is present only when there are ≥2. Every editor that changes WHICH visuals a slide has
 * — the GUI figure list (edit / delete / reorder), MCP set_slide_diagram's `figure`, the edit carry
 * (apply-slide-edit.carryOmittedBlocks) — writes through `withFigures`, so the singular fields and the
 * `figures` copies are re-derived together from one list and cannot drift. withFigures is the inverse
 * of slideFigures (pinned by tests/figures-edit-392.test.ts); a slide left with ≤1 visual gets no
 * `figures` (single-visual decks stay byte-identical in content).
 *
 * A behind image is a backmost layer, not a body visual: it is never in the list and is kept as is.
 * Pure logic (R2).
 */
import type { SlideIR, FigureBlock } from "./slide-schema";
import { slideFigures, figureFields } from "./slide-figures";

/** The SlideIR fields that hold body visuals (all re-derived by withFigures). */
const VISUAL_FIELDS = ["diagram", "mermaidBlock", "table", "code", "image", "figures"] as const;

/** `slide` with its body visuals replaced by `list` (in that order). */
export function withFigures(slide: SlideIR, list: readonly FigureBlock[]): SlideIR {
  const rest: SlideIR = { ...slide };
  for (const k of VISUAL_FIELDS) delete rest[k];
  const fields = figureFields(list);
  const behind = slide.image?.behind ? slide.image : undefined;
  if (behind && fields.image) throw new Error("背面画像のあるスライドに本文画像は置けません（単数 image を共有するため）");
  return { ...rest, ...(behind ? { image: behind } : {}), ...fields };
}

function at(list: readonly FigureBlock[], n: number): void {
  if (!Number.isInteger(n) || n < 0 || n >= list.length) throw new RangeError(`ビジュアルの位置 ${n} は範囲外です（0..${list.length - 1}）`);
}

/** Replace the `n`-th visual (0-based, slideFigures order). */
export function updateFigure(slide: SlideIR, n: number, figure: FigureBlock): SlideIR {
  const list = slideFigures(slide);
  at(list, n);
  return withFigures(slide, list.map((f, k) => (k === n ? figure : f)));
}

/** Delete the `n`-th visual (0-based). A later one of the same kind becomes the singular field. */
export function removeFigure(slide: SlideIR, n: number): SlideIR {
  const list = slideFigures(slide);
  at(list, n);
  return withFigures(slide, list.filter((_, k) => k !== n));
}

/** Move the visual at `from` to position `to` (0-based). The md writes visuals in this order. */
export function moveFigure(slide: SlideIR, from: number, to: number): SlideIR {
  const list = slideFigures(slide);
  at(list, from);
  at(list, to);
  const next = [...list];
  const [f] = next.splice(from, 1);
  next.splice(to, 0, f);
  return withFigures(slide, next);
}

/** The 1-based positions (in slideFigures) of the slide's figures = diagram / Mermaid visuals. "The
 *  n-th figure" of set_slide_diagram's `figure` and of applyFigureYaml's target is diagramFigureNumbers[n-1]. */
export function diagramFigureNumbers(slide: SlideIR): number[] {
  return slideFigures(slide).flatMap((f, k) => (f.kind === "diagram" || f.kind === "mermaid" ? [k + 1] : []));
}

/** Kinds an edit that omits them carries from the old slide (#220 B3 — an image is not carried). */
const CARRIED = new Set<FigureBlock["kind"]>(["diagram", "mermaid", "table", "code"]);

/**
 * #392 段 3: the per-visual carry of an edit (MCP set_slide_markdown ⇄ GUI reconcile) on a slide that
 * HAS ≥2 visuals. Per kind, the edit's i-th visual of that kind replaces the old i-th; the old ones the
 * edit leaves out stay in their place (a text-only edit keeps every visual); visuals the edit adds
 * beyond the old count follow in the edit's order. An edit that carries every old visual is taken as
 * is — its order included. Omitted images are not carried (as for a single image, #220 B3).
 */
export function carryFigures(old: SlideIR, edited: SlideIR): SlideIR {
  const before = slideFigures(old);
  const after = slideFigures(edited);
  const byKind = (list: readonly FigureBlock[], kind: FigureBlock["kind"]) => list.filter((f) => f.kind === kind);
  const omits = before.some((f) => CARRIED.has(f.kind) && byKind(after, f.kind).length < byKind(before, f.kind).length);
  if (!omits) return edited;
  const seen = new Map<FigureBlock["kind"], number>();
  const merged: FigureBlock[] = [];
  for (const f of before) {
    const i = seen.get(f.kind) ?? 0;
    seen.set(f.kind, i + 1);
    const repl = byKind(after, f.kind)[i];
    if (repl) merged.push(repl);
    else if (CARRIED.has(f.kind)) merged.push(f);
  }
  const extra = after.filter((f) => byKind(after, f.kind).indexOf(f) >= (seen.get(f.kind) ?? 0));
  return withFigures(edited, [...merged, ...extra]);
}

/** Delete the slide's first image (the singular one the form shows): a behind image is just dropped; a
 *  body image leaves the list through removeFigure, so a 2nd image becomes the first (not orphaned). */
export function removeFirstImage(slide: SlideIR): SlideIR {
  if (!slide.image) return slide;
  if (slide.image.behind) {
    const rest: SlideIR = { ...slide };
    delete rest.image;
    return rest;
  }
  return removeFigure(slide, slideFigures(slide).findIndex((f) => f.kind === "image"));
}
