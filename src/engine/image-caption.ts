/**
 * image-caption.ts — an embedded image's alt text as a CAPTION (#399): the one-line description /
 * source note directly under a figure, plus the alt as the picture's accessibility text (descr).
 *
 * ONE geometry for both consumers (R8): the PPTX export (placeholder-filler → a text-box <p:sp>) and
 * the live/HTML preview (SlidePreview → an absolutely-placed div) both call imageCaption, so the
 * caption can't land in a different place in preview than in the export (WYSIWYG).
 *
 * Rules:
 *   - alt empty (or whitespace) → no caption and no descr, so existing decks stay byte-identical;
 *   - the caption sits under the DRAWN image (drawnImage — a letterboxed `contain` image's real
 *     bottom, not its box's), spanning the box width, text centered;
 *   - a caption that would run off the slide bottom is pulled up to end at the bottom edge;
 *   - its color is the TEMPLATE's text color for the image's region (the placeholder's resolved body
 *     color — layout → master), so it reads on a dark panel (Midnight's Closing panel resolves a light
 *     CADCFC) as well as on a white content area (1E293B); the neutral gray is only the fallback;
 *   - a BEHIND (backmost) image gets descr only — a backdrop has no "under the figure" line.
 *
 * Pure logic (R2).
 */
import type { ImageBlock, ImageRect } from "./slide-schema";
import { drawnImage, SLIDE_IN } from "./visual-placement";
import { escXml } from "./md-to-ooxml";

/** Caption box height (inches) — one line at CAPTION_FONT_PT with room for descenders. */
export const CAPTION_H = 0.3;
/** Caption font size (pt) — smaller than body text, like a figure note. */
export const CAPTION_FONT_PT = 11;
/** Fallback caption color (hex, no #) when no template text color is known — a neutral gray. */
export const CAPTION_COLOR = "595959";

export interface ImageCaption {
  text: string;
  rect: ImageRect;
  fontPt: number;
  color: string;
}

/** The caption to draw for `image` placed in `box` (inches), or undefined when there is none.
 *  `textColor` = the image placeholder's resolved body color (PlaceholderStyle.fontColor). */
export function imageCaption(
  image: ImageBlock,
  box: ImageRect,
  textColor?: string,
  slideH: number = SLIDE_IN.h,
): ImageCaption | undefined {
  const text = image.alt.trim();
  if (!text || image.behind) return undefined;
  const drawn = drawnImage(image, box).rect;
  const y = Math.max(0, Math.min(drawn.y + drawn.h, slideH - CAPTION_H));
  return { text, rect: { x: box.x, y, w: box.w, h: CAPTION_H }, fontPt: CAPTION_FONT_PT, color: textColor || CAPTION_COLOR };
}

/** The ` descr="…"` attribute for a picture's <p:cNvPr> — empty string when alt is empty. */
export function imageDescrAttr(alt: string): string {
  const text = alt.trim();
  return text ? ` descr="${escXml(text)}"` : "";
}

/** The caption as a PPTX text box. Zero insets so the text sits exactly where the preview draws it. */
export function imageCaptionShapeXml(shapeId: number, cap: ImageCaption): string {
  const EMU = (inches: number) => Math.round(inches * 914400);
  const r = cap.rect;
  return `<p:sp>`
    + `<p:nvSpPr><p:cNvPr id="${shapeId}" name="ImageCaption"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${EMU(r.x)}" y="${EMU(r.y)}"/><a:ext cx="${EMU(r.w)}" cy="${EMU(r.h)}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>`
    + `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ja-JP" sz="${Math.round(cap.fontPt * 100)}" dirty="0">`
    + `<a:solidFill><a:srgbClr val="${cap.color}"/></a:solidFill></a:rPr><a:t>${escXml(cap.text)}</a:t></a:r></a:p>`
    + `</p:txBody></p:sp>`;
}
