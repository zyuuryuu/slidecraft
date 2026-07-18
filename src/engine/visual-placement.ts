/**
 * visual-placement.ts — WHERE a slide's VISUALS go: which placeholder region a figure / table /
 * code block / image occupies, and the geometry of the box it gets.
 *
 * Split out of placeholder-binding.ts (R1: 400 行) — but the real reason is #124. That bug existed
 * BECAUSE the text route and the visual route are separate: the do-no-harm chrome gate was added to
 * bindContentByRole's Pass 2 (text) while figures kept reaching the same mislabeled header band
 * through nthBody/imagePlaceholder. The two routes are now two modules, so "does the visual route
 * honor this too?" is a question the file layout makes you ask.
 *
 * Like its text twin, every resolver here is SHARED by the PPTX export (placeholder-filler) and the
 * live preview (SlidePreview) — and the editor's overlay (SlideEditor) — so a figure can NEVER land
 * in a different box in preview than it does in the export (WYSIWYG).
 *
 * Pure logic (R2): no DOM / Tauri. The pointer→inch conversion and gesture state stay in components.
 */
import type { SlideIR, ImageBlock, ImageRect } from "./slide-schema";
import type { PlaceholderInfo } from "./template-loader";
import { placeholderRole, isContentBody } from "./template-catalog";
import { sortByIdx } from "./placeholder-binding";

/**
 * The layout's BODY placeholders in stable order — a figure/table rides the Nth of these.
 *
 * DO-NO-HARM gate (#124, master-intake.md §2 部品2): a placeholder the scorer inferred "chrome" (a thin
 * edge strip — a running header / footer band) is DECORATION, never a content region, so it must not
 * occupy a body ORDINAL. bindContentByRole's Pass 2 already gates the TEXT route this way; the VISUAL
 * route (nthBody / imagePlaceholder → figure, table, code, image) reached the same mislabeled band
 * through here, so a body-TYPED chrome band (公文書's 資料名スロット: type="body" 3.1"×0.62" at the top
 * edge, fs 9) collected figures — worst case 05_比較表, whose ONLY body IS the band, drew the table
 * inside the header strip. The ladder can't fix it: an explicit type="body" is authoritative there
 * (#96 only closed the RECOVERY tier), so the gate belongs on the ordinal.
 *
 * Reads the SAME signal as the text gate (the load-time `inferredFunction` stamp) so the two routes
 * can't disagree about what chrome is. Keep it ROLE-scoped: healthy chrome (footer/date/slideNumber)
 * is already a meta role and never reaches this filter, so healthy masters are unaffected.
 *
 * The chrome gate is the SHARED isContentBody predicate (template-catalog), so this ordinal and the
 * catalog's bodyCount (#127) can never disagree about how many bodies a layout has — one definition.
 *
 * A layout whose bodies are ALL chrome yields [] → nthBody returns undefined → the visual has no home.
 * That is deliberate ("空欄OK・誤注入NG"): callers must report it (unboundVisuals), never re-home it.
 */
export function bodyPlaceholders(layoutPlaceholders: readonly PlaceholderInfo[]): PlaceholderInfo[] {
  return [...layoutPlaceholders].sort(sortByIdx).filter(isContentBody);
}

/** The BODY placeholder a visual targets: placeholderIdx "1"→1st body, "2"→2nd, … (1-based). */
export function nthBody(bodyPhs: readonly PlaceholderInfo[], placeholderIdx?: string): PlaceholderInfo | undefined {
  if (!placeholderIdx) return undefined;
  return bodyPhs[Math.max(1, parseInt(placeholderIdx) || 1) - 1];
}

/**
 * The placeholder an EMBEDDED IMAGE targets. Unlike a diagram/table (always a BODY region), an image
 * prefers a real PICTURE frame (type="pic" → role "picture") when the layout offers one — that's what
 * an image-specific placeholder is for — riding the Nth picture by the same 1-based ordinal, and
 * clamping a too-large ordinal to a picture rather than dropping to body. Layouts WITHOUT a picture
 * frame (all bundled canonical/report masters) fall back to nthBody(body) → byte-identical to before.
 * Pure (R2); shared by preview / form / export so the image can't bind to different frames.
 */
export function imagePlaceholder(
  layoutPlaceholders: readonly PlaceholderInfo[],
  placeholderIdx?: string,
): PlaceholderInfo | undefined {
  if (!placeholderIdx) return undefined;
  const pics = [...layoutPlaceholders].sort(sortByIdx).filter((p) => placeholderRole(p) === "picture");
  if (pics.length) return pics[Math.max(1, parseInt(placeholderIdx) || 1) - 1] ?? pics[0];
  return nthBody(bodyPlaceholders(layoutPlaceholders), placeholderIdx);
}

/** 16:9 slide size in inches (12192000×6858000 EMU). */
export const SLIDE_IN = { w: 12192000 / 914400, h: 6858000 / 914400 };

/**
 * The image's box (inches): the manual `rect` override, else its target placeholder's box. A BEHIND
 * image is a NORMAL-sized figure that merely sits behind the content — it uses the SAME box as a body
 * figure would (its placeholder region), NOT the whole slide. Only when a behind image has no target
 * placeholder (e.g. a cover with no body) does it fall back to a centered ~70% box — never full-bleed.
 * Shared by preview + export so it lands identically in both (WYSIWYG). Pure (R2).
 */
export function imageRect(image: ImageBlock, ph: PlaceholderInfo | undefined): ImageRect | undefined {
  if (image.rect) return image.rect;
  if (ph) return { x: ph.style.x, y: ph.style.y, w: ph.style.w, h: ph.style.h };
  if (image.behind) return { x: SLIDE_IN.w * 0.15, y: SLIDE_IN.h * 0.15, w: SLIDE_IN.w * 0.7, h: SLIDE_IN.h * 0.7 };
  return undefined;
}

/** The aspect ratio (w/h) to preserve when resizing an image: the measured intrinsic aspect, else the
 *  current box's aspect, else 1. ONE source of truth so the preview drag and the form-numeric resize
 *  lock to the SAME ratio (they diverged when each inlined its own fallback). Pure. */
export function imageAspectRatio(image: ImageBlock, box: ImageRect | undefined): number {
  return image.aspect && image.aspect > 0 ? image.aspect : box && box.h > 0 ? box.w / box.h : 1;
}

/** The PPTX picture geometry for an image dropped in `box` (inches): the actual <p:pic> rect plus an
 *  optional crop (srcRect, fractions in 1/1000 %). PowerPoint's blipFill STRETCHES to the pic rect, so
 *  we do the aspect math here — matching the browser's object-fit so preview == export (WYSIWYG):
 *   • aspect unknown or already == box → fill the box (no distortion, no crop);
 *   • cover → fill the box, crop the overflow via srcRect;
 *   • contain → shrink the pic to fit inside the box, centered (letterbox), no crop. Pure. */
export function fitImageInBox(
  box: ImageRect,
  fit: "contain" | "cover" | undefined,
  aspect: number | undefined,
): { rect: ImageRect; srcRect?: { l: number; t: number; r: number; b: number } } {
  if (!aspect || aspect <= 0 || box.w <= 0 || box.h <= 0) return { rect: box };
  const boxAr = box.w / box.h;
  if (Math.abs(boxAr - aspect) < 1e-4) return { rect: box }; // aspect-locked: box already matches
  if (fit === "cover") {
    if (aspect > boxAr) {
      const c = Math.round(((1 - boxAr / aspect) / 2) * 100000); // wider → crop left+right
      return { rect: box, srcRect: { l: c, t: 0, r: c, b: 0 } };
    }
    const c = Math.round(((1 - aspect / boxAr) / 2) * 100000); // taller → crop top+bottom
    return { rect: box, srcRect: { l: 0, t: c, r: 0, b: c } };
  }
  // contain (default): letterbox inside the box.
  if (aspect > boxAr) {
    const h = box.w / aspect; // width-bound
    return { rect: { x: box.x, y: box.y + (box.h - h) / 2, w: box.w, h } };
  }
  const w = box.h * aspect; // height-bound
  return { rect: { x: box.x + (box.w - w) / 2, y: box.y, w, h: box.h } };
}

/** New image rect for a preview drag gesture (案B): "move" translates the box (clamped onto the slide);
 *  a corner handle resizes from the OPPOSITE (fixed) corner, width-driven with the height following the
 *  aspect (so a drag never distorts), clamped to a min size and kept within the slide. dx/dy in inches.
 *  Pure — the pointer→inch conversion + gesture state live in the component. */
export function dragImageRect(
  mode: "move" | "nw" | "ne" | "sw" | "se",
  base: ImageRect,
  dx: number,
  dy: number,
  aspect: number,
  slideW: number,
  slideH: number,
): ImageRect {
  const MIN = 0.4;
  const ar = aspect > 0 ? aspect : base.h > 0 ? base.w / base.h : 1;
  if (mode === "move") {
    return {
      x: Math.min(Math.max(0, base.x + dx), Math.max(0, slideW - base.w)),
      y: Math.min(Math.max(0, base.y + dy), Math.max(0, slideH - base.h)),
      w: base.w,
      h: base.h,
    };
  }
  const right = mode === "ne" || mode === "se";
  const bottom = mode === "sw" || mode === "se";
  const ax = right ? base.x : base.x + base.w; // fixed anchor = opposite corner
  const ay = bottom ? base.y : base.y + base.h;
  const maxW = Math.min(right ? slideW - ax : ax, (bottom ? slideH - ay : ay) * ar);
  const w = Math.max(MIN, Math.min(right ? base.w + dx : base.w - dx, maxW));
  const h = w / ar;
  return { x: right ? ax : ax - w, y: bottom ? ay : ay - h, w, h };
}

/** A visual (figure/table/code/image) kind, as the slide model carries it. */
export type VisualKind = "diagram" | "mermaid" | "table" | "code" | "image";

/** One visual that has no body region to live in, tagged with the ordinal it asked for. */
export interface UnboundVisual {
  kind: VisualKind;
  placeholderIdx: string;
}

/**
 * DO-NO-HARM / no-silent-drop (#124), the VISUAL twin of unboundContent: the slide's visuals that
 * resolve to NO placeholder region and are therefore not drawn. The invariant is "every visual is
 * drawn OR reported" — with the chrome gate on bodyPlaceholders, a layout whose only body was a
 * header band now offers no region, and a silently missing table would just trade mis-injection for
 * a silent drop. Callers surface this instead.
 *
 * It OBSERVES the same resolvers the renderers use (bodyPlaceholders/nthBody/imagePlaceholder), so it
 * cannot disagree with what export/preview actually draw. Two deliberate non-drops:
 *   - a SOLO figure (ordinal 1) fills the whole slide by design — it needs no region, so a region-less
 *     layout is not a drop for it;
 *   - a BEHIND image is a backmost layer with its own fallback box, not a bound region.
 * Scope is BINDING: a visual that fails to render for another reason (e.g. a mermaid block with no
 * rasterized svgCache) is not a binding drop and isn't reported here. Pure (R2).
 */
export function unboundVisuals(
  slide: SlideIR,
  layoutPlaceholders: readonly PlaceholderInfo[],
): UnboundVisual[] {
  const bodyPhs = bodyPlaceholders(layoutPlaceholders);
  const out: UnboundVisual[] = [];
  const needsRegion = (kind: VisualKind, placeholderIdx: string) => {
    if (!nthBody(bodyPhs, placeholderIdx)) out.push({ kind, placeholderIdx });
  };
  // A figure at ordinal 1 is SOLO (full-slide) — see buildSlideXml; only ordinal 2+ is region-bound.
  const regionBound = (placeholderIdx: string) => (parseInt(placeholderIdx) || 1) !== 1;
  if (slide.diagram && regionBound(slide.diagram.placeholderIdx)) needsRegion("diagram", slide.diagram.placeholderIdx);
  if (slide.mermaidBlock) needsRegion("mermaid", slide.mermaidBlock.placeholderIdx);
  if (slide.table) needsRegion("table", slide.table.placeholderIdx);
  if (slide.code) needsRegion("code", slide.code.placeholderIdx);
  if (slide.image && !slide.image.behind && !imagePlaceholder(layoutPlaceholders, slide.image.placeholderIdx))
    out.push({ kind: "image", placeholderIdx: slide.image.placeholderIdx });
  return out;
}
