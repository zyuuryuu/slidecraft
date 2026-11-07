/**
 * image-gesture.ts — the pointer-gesture state of an image drag/resize on the preview (案B), as PURE
 * functions so it is testable without a DOM. Pixels in, inches out: the pointer delta is divided by the
 * render scale and handed to the SHARED dragImageRect (the one rect math — front and behind images both
 * go through it, #122 / R8). The React wiring (pointer capture, live state) lives in SlideImageLayer.
 */
import { dragImageRect } from "../engine/visual-placement";
import type { ImageRect } from "../engine/slide-schema";

export type ImageDragMode = "move" | "nw" | "ne" | "sw" | "se";

export interface ImageGesture {
  mode: ImageDragMode;
  sx: number;
  sy: number;
  base: ImageRect;
  latest: ImageRect;
  moved: boolean;
}

/** Below this many pixels (|dx|+|dy|) a press is a click, not a drag — nothing is committed. */
export const CLICK_THRESHOLD_PX = 3;

export function startImageGesture(mode: ImageDragMode, base: ImageRect, clientX: number, clientY: number): ImageGesture {
  return { mode, sx: clientX, sy: clientY, base, latest: base, moved: false };
}

/** Advance the gesture to the pointer at (clientX, clientY); returns the live rect, or null while the
 *  press is still under the click threshold. Mutates `g` (it is the gesture's own state). */
export function moveImageGesture(
  g: ImageGesture,
  clientX: number,
  clientY: number,
  scale: number,
  aspect: number,
  slideW: number,
  slideH: number,
): ImageRect | null {
  if (!g.moved && Math.abs(clientX - g.sx) + Math.abs(clientY - g.sy) < CLICK_THRESHOLD_PX) return null;
  g.moved = true;
  g.latest = dragImageRect(g.mode, g.base, (clientX - g.sx) / scale, (clientY - g.sy) / scale, aspect, slideW, slideH);
  return g.latest;
}

/** The rect to commit on release (one undo entry), or null for a click. */
export function endImageGesture(g: ImageGesture): ImageRect | null {
  return g.moved ? g.latest : null;
}
