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
  /** Open (line) arrowhead instead of a filled triangle — async sequence messages. */
  openArrow?: boolean;
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
  /**
   * Begin / end a logical sub-group. Every shape drawn between begin and end
   * forms one group (PPTX: a `<p:grpSp>`; SVG: a `<g>`). Nestable. This lets a
   * diagram export as ONE object whose nodes/edges/participants are individually
   * grabbable sub-groups, instead of dozens of disconnected loose shapes.
   */
  beginGroup(): void;
  endGroup(): void;
  /**
   * Draw a filled pie wedge: a slice of a circle centred at (cx,cy) with radius r,
   * sweeping from startDeg to endDeg (degrees, 0 = 3 o'clock, increasing clockwise).
   * For pie charts. Optional outline separates adjacent slices.
   */
  wedge(cx: number, cy: number, r: number, startDeg: number, endDeg: number, opts: { fill: string; line?: LineSpec }): void;
}

export interface PaintOptions {
  theme?: ThemeConfig;
  useHeaderBar?: boolean;
  /**
   * Suppress the diagram's OWN title (header bar or plain text). Used when the
   * diagram is embedded in a slide that already has a title placeholder, so the
   * two don't overlap/duplicate. Keeps preview and export in agreement.
   */
  omitTitle?: boolean;
  /**
   * Confine the whole diagram (shapes, edges, text, all uniformly scaled) into
   * this slide region (inches). Lets a diagram sit beside body text instead of
   * taking the full slide. Omit for the full-slide default.
   */
  region?: Box;
  /**
   * Explicit scale+offset, used instead of fitting to `region`. The preview
   * passes a FIXED transform while dragging a node in a region diagram, so the
   * whole diagram doesn't rescale as the dragged node's bbox changes.
   */
  transform?: { scale: number; offsetX: number; offsetY: number };
}

/**
 * Wraps a DrawTarget to scale+translate everything into a sub-region, so the
 * painter can keep emitting full-slide coordinates while the output lands in a
 * box (diagram-beside-text). Font sizes and stroke widths scale uniformly too.
 */
export class TransformedTarget implements DrawTarget {
  private t: DrawTarget;
  private s: number;
  private ox: number;
  private oy: number;

  constructor(target: DrawTarget, scale: number, offsetX: number, offsetY: number) {
    this.t = target;
    this.s = scale;
    this.ox = offsetX;
    this.oy = offsetY;
  }

  private box(b: Box): Box {
    return { x: b.x * this.s + this.ox, y: b.y * this.s + this.oy, w: b.w * this.s, h: b.h * this.s };
  }
  private pt<P extends { x: number; y: number }>(p: P): P {
    return { ...p, x: p.x * this.s + this.ox, y: p.y * this.s + this.oy };
  }

  background(color: string): void {
    this.t.background(color);
  }
  shape(kind: ShapeType, box: Box, opts: { fill: string | null; line?: LineSpec; rectRadius?: number }): void {
    this.t.shape(kind, this.box(box), {
      fill: opts.fill,
      line: opts.line ? { ...opts.line, width: opts.line.width * this.s } : undefined,
      rectRadius: opts.rectRadius !== undefined ? opts.rectRadius * this.s : undefined,
    });
  }
  line(from: ConnectionPoint, to: ConnectionPoint, opts: EdgeLineOpts): void {
    this.t.line(this.pt(from), this.pt(to), { ...opts, width: opts.width * this.s });
  }
  text(lines: TextRun[], box: Box, opts: TextOpts): void {
    this.t.text(lines.map((l) => ({ ...l, fontSize: l.fontSize * this.s })), this.box(box), opts);
  }
  // Group boundaries pass straight through — the wrapped target records them and
  // the shapes land grouped in whatever (scaled) coordinates they end up at.
  beginGroup(): void {
    this.t.beginGroup();
  }
  endGroup(): void {
    this.t.endGroup();
  }
  wedge(cx: number, cy: number, r: number, startDeg: number, endDeg: number, opts: { fill: string; line?: LineSpec }): void {
    this.t.wedge(cx * this.s + this.ox, cy * this.s + this.oy, r * this.s, startDeg, endDeg, {
      fill: opts.fill,
      line: opts.line ? { ...opts.line, width: opts.line.width * this.s } : undefined,
    });
  }
}

/** Fit a content bounding box into a region (preserve aspect, centered, padded). */
export function fitTransform(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  region: Box,
  pad = 0.12,
): { scale: number; offsetX: number; offsetY: number } {
  const bw = Math.max(bbox.maxX - bbox.minX, 0.01);
  const bh = Math.max(bbox.maxY - bbox.minY, 0.01);
  const availW = Math.max(region.w - 2 * pad, 0.1);
  const availH = Math.max(region.h - 2 * pad, 0.1);
  const scale = Math.min(availW / bw, availH / bh);
  const offsetX = region.x + pad + (availW - bw * scale) / 2 - bbox.minX * scale;
  const offsetY = region.y + pad + (availH - bh * scale) / 2 - bbox.minY * scale;
  return { scale, offsetX, offsetY };
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
