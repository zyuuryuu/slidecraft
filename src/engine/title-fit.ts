/**
 * title-fit.ts — #437: shrink an over-long slide title until it fits its title box (R7 pre-computation).
 *
 * PowerPoint's autofit is not recomputed until the text is edited (R7), and most templates' title
 * bodyPr carries no autofit at all (Midnight: `wrap="square" anchor="t"` → the wrapped line spills out
 * of the box), so the size is computed HERE and baked into the title runs (`sz`). ONE function
 * (fitTitle) is read by all three consumers so they cannot disagree (R8):
 *   - export   — placeholder-filler bakes `titleRunSz` into the title runs
 *   - preview  — SlidePreview renders the title placeholder at `titleFontPt`
 *   - review   — deck-diagnostics warns `title-overflow` iff `fits` is false (never-silent)
 * A title that already fits returns its base size → nothing is baked → output stays byte-identical.
 *
 * Text width uses the SAME estimate the diagram shrink shares between SVG and PPTX (#228,
 * draw-target: CJK ≈ 1em, Latin ≈ 0.55em, errs wide); the box uses placeholderFitBox's inset (0.1in)
 * and line height (1.2em). Pure logic (R2): no DOM / Tauri.
 */

import type { SlideIR, PlaceholderContent, Paragraph } from "./slide-schema";
import { slideIdxRole } from "./template-catalog";
import { wrapToWidth } from "./draw-target";

/**
 * Legibility floor as a share of the template's own title size. A ratio, not an absolute pt: title
 * placeholders in the committed corpus run from 10.5pt (card headings) to 64pt (statements), so one
 * absolute floor is either meaningless for the big ones or unreachable for the small ones.
 * Calibration (Midnight Content, 28pt in 10.0×0.52in): floor 19.6 → the smallest step is 20pt, still
 * above every Midnight Content body size (13–16pt), so the title keeps its heading rank. The Issue's
 * repro title shrinks to 22pt and fits; a title needing < 20pt is reported, not shrunk further.
 */
export const TITLE_MIN_SCALE = 0.7;

const INSET_IN = 0.1; // placeholderFitBox's pad (template-catalog)
const LINE_HEIGHT = 1.2; // placeholderFitBox's line height (template-catalog)
const STEP_PT = 1;

export interface TitleFit {
  /** The template's title size (pt). */
  basePt: number;
  /** The size the title is drawn at: basePt when it fits, else the largest fitting step ≥ minPt. */
  fontPt: number;
  /** Floor (pt) = basePt × TITLE_MIN_SCALE. */
  minPt: number;
  /** false ⇔ even at the floor the title needs more lines than the box holds. */
  fits: boolean;
  /** Estimated lines at fontPt vs lines the box holds at fontPt. */
  lines: number;
  maxLines: number;
}

/** The slide's content for a role (title idx 0/15, body idx 1/2..9) — the content object binding
 *  carries by reference, so `content === slideRoleContent(slide, "title")` identifies the title box. */
export function slideRoleContent(slide: SlideIR, role: "title" | "body"): PlaceholderContent | undefined {
  const hasCtr = slide.placeholders.some((p) => p.idx === "0");
  return slide.placeholders.find((p) => slideIdxRole(p.idx, hasCtr) === role);
}

const textOf = (p: Paragraph) => p.segments.map((s) => s.text).join("");

function measure(paragraphs: readonly Paragraph[], style: { w: number; h: number }, pt: number): { lines: number; maxLines: number } {
  const maxW = (style.w - 2 * INSET_IN) * 72; // pt, same unit as estTextWidth(…, pt)
  const lines = paragraphs.reduce((n, p) => n + (textOf(p) ? wrapToWidth(textOf(p), maxW, pt).length : 1), 0);
  // A title box shorter than one line still shows one line (title bands are often < 1.2em tall).
  const maxLines = Math.max(1, Math.floor(Math.max(style.h - 2 * INSET_IN, 0) / ((pt / 72) * LINE_HEIGHT)));
  return { lines, maxLines };
}

/** Step the title size down from the template's size until the estimate fits the box (or the floor). */
export function fitTitle(paragraphs: readonly Paragraph[], style: { w: number; h: number; fontSize: number }): TitleFit {
  const basePt = style.fontSize;
  const minPt = basePt * TITLE_MIN_SCALE;
  const unchanged = { basePt, fontPt: basePt, minPt, fits: true, lines: 0, maxLines: 0 };
  // Nothing to measure (no text, no size, no usable width) → leave the title alone.
  if (basePt <= 0 || style.w <= 2 * INSET_IN + basePt / 72 || !paragraphs.some((p) => textOf(p).trim())) return unchanged;

  let last = { pt: basePt, ...measure(paragraphs, style, basePt) };
  for (let pt = basePt; pt >= minPt; pt -= STEP_PT) {
    last = { pt, ...measure(paragraphs, style, pt) };
    if (last.lines <= last.maxLines) return { basePt, fontPt: pt, minPt, fits: true, lines: last.lines, maxLines: last.maxLines };
  }
  return { basePt, fontPt: last.pt, minPt, fits: false, lines: last.lines, maxLines: last.maxLines };
}

/** The pt the title box is drawn at when `content` is the slide's title and it had to shrink; else
 *  undefined (= the template's size, untouched). Shared by export and preview. */
export function titleFontPt(slide: SlideIR, content: PlaceholderContent, style: { w: number; h: number; fontSize: number }): number | undefined {
  if (content !== slideRoleContent(slide, "title")) return undefined;
  const fit = fitTitle(content.paragraphs, style);
  return fit.fontPt < fit.basePt ? fit.fontPt : undefined;
}
