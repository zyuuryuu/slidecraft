/**
 * draw-target.ts — Backend-agnostic drawing abstraction for diagrams.
 *
 * The DrawTarget interface is implemented by each renderer backend
 * (PptxDrawTarget for PPTX, SvgDrawTarget for the preview). The shared painter
 * (diagram-painter.ts) issues these primitives, so every backend draws the
 * same thing — preview and PPTX cannot diverge. Coordinates are in inches.
 */

import type { ShapeType } from "./schema";
import type { ThemeConfig } from "./theme";
import type { ConnectionPoint } from "./layout-engine";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LineSpec {
  /** Omitted → no stroke color emitted (e.g. zero-width filler line). */
  color?: string;
  width: number;
  /** Omitted → no dash attribute emitted at all (kept for byte-fidelity). */
  dash?: boolean;
}

export interface TextRun {
  text: string;
  fontSize: number;
  fontFace: string;
  color: string;
  bold: boolean;
}

export interface TextOpts {
  align?: "left" | "center" | "right";
  valign?: "top" | "middle";
  shrink?: boolean;
  wrap?: boolean;
}

export interface EdgeLineOpts {
  color: string;
  width: number;
  arrow?: boolean;
  dash?: boolean;
}

export interface DrawTarget {
  background(color: string): void;
  /** Draw a filled shape. `fill: null` means no fill (transparent zone). */
  shape(
    kind: ShapeType,
    box: Box,
    opts: { fill: string | null; line?: LineSpec; rectRadius?: number },
  ): void;
  line(from: ConnectionPoint, to: ConnectionPoint, opts: EdgeLineOpts): void;
  /** Each TextRun is one stacked line/paragraph inside the box. */
  text(lines: TextRun[], box: Box, opts: TextOpts): void;
}

export interface PaintOptions {
  theme?: ThemeConfig;
  useHeaderBar?: boolean;
}

/** Resolved node style after merging classDefs + inline style onto defaults. */
export interface ResolvedStyle {
  fill?: string;
  border?: string;
  border_width: number;
  border_dash: boolean;
  font_color: string;
  font_size: number;
  font_bold: boolean;
}

export function scaledFontSize(
  baseSize: number,
  scale: number,
  minSize: number = 5,
): number {
  if (scale >= 1.0) return baseSize;
  return Math.max(baseSize * scale, minSize);
}
