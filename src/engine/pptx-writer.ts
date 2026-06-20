/**
 * PPTX Writer — Generates PowerPoint slides from DiagramSpec + layout positions.
 *
 * Thin PptxGenJS backend for the shared diagram painter (diagram-painter.ts).
 * All drawing/geometry lives in the painter; this file only maps abstract draw
 * commands onto editable PptxGenJS shapes, so the PPTX can never diverge from
 * the SVG live preview (both go through paintDiagram).
 */

import PptxGenJS from "pptxgenjs";
import type { DiagramSpec, ShapeType } from "./schema";
import type { ThemeConfig } from "./theme";
import { SLIDE_W, SLIDE_H, type ConnectionPoint } from "./layout-engine";
import {
  paintDiagram,
  type DrawTarget,
  type Box,
  type LineSpec,
  type TextRun,
  type TextOpts,
  type EdgeLineOpts,
} from "./diagram-painter";

// ── Constants ──

const PPTX_SHAPE_MAP: Record<ShapeType, string> = {
  rect: "rect",
  rounded_rect: "roundRect",
  diamond: "diamond",
  circle: "ellipse",
  oval: "ellipse",
  hexagon: "hexagon",
  class: "rect", // class boxes are drawn as a rect + compartment dividers/text
};

function hexToRgb(hex: string): string {
  return hex.replace(/^#/, "");
}

// ── PptxGenJS draw target ──

class PptxDrawTarget implements DrawTarget {
  private slide: PptxGenJS.Slide;

  constructor(slide: PptxGenJS.Slide) {
    this.slide = slide;
  }

  background(color: string): void {
    this.slide.background = { color: hexToRgb(color) };
  }

  shape(
    kind: ShapeType,
    box: Box,
    opts: { fill: string | null; line?: LineSpec; rectRadius?: number },
  ): void {
    const pptxShape = PPTX_SHAPE_MAP[kind] ?? "rect";
    const shapeOpts: PptxGenJS.ShapeProps = {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill: opts.fill === null ? { type: "none" } : { color: hexToRgb(opts.fill) },
    };
    if (opts.line) {
      const line: Record<string, unknown> = { width: opts.line.width };
      if (opts.line.color !== undefined) line.color = hexToRgb(opts.line.color);
      if (opts.line.dash !== undefined) line.dashType = opts.line.dash ? "dash" : "solid";
      shapeOpts.line = line as PptxGenJS.ShapeLineProps;
    }
    if (opts.rectRadius !== undefined) shapeOpts.rectRadius = opts.rectRadius;
    this.slide.addShape(pptxShape as keyof typeof PptxGenJS.ShapeType, shapeOpts);
  }

  line(from: ConnectionPoint, to: ConnectionPoint, opts: EdgeLineOpts): void {
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const w = Math.abs(to.x - from.x) || 0.001;
    const h = Math.abs(to.y - from.y) || 0.001;
    this.slide.addShape("line", {
      x,
      y,
      w,
      h,
      line: {
        color: hexToRgb(opts.color),
        width: opts.width,
        dashType: opts.dash ? "dash" : "solid",
        endArrowType: opts.arrow ? "triangle" : "none",
      },
      flipH: to.x < from.x,
      flipV: to.y < from.y,
    });
  }

  text(lines: TextRun[], box: Box, opts: TextOpts): void {
    const container: PptxGenJS.TextPropsOptions = { x: box.x, y: box.y, w: box.w, h: box.h };
    if (opts.align !== undefined) container.align = opts.align;
    if (opts.valign !== undefined) container.valign = opts.valign;
    if (opts.shrink) container.fit = "shrink";
    if (opts.wrap) container.wrap = true;

    if (lines.length === 1) {
      const r = lines[0];
      this.slide.addText(r.text, {
        ...container,
        fontSize: r.fontSize,
        fontFace: r.fontFace,
        color: hexToRgb(r.color),
        bold: r.bold,
      });
    } else {
      const runs = lines.map((r) => ({
        text: r.text,
        options: {
          fontSize: r.fontSize,
          fontFace: r.fontFace,
          color: hexToRgb(r.color),
          bold: r.bold,
          ...(opts.align !== undefined ? { align: opts.align } : {}),
        },
      }));
      this.slide.addText(runs, container);
    }
  }
}

// ── Main Render Function ──

export interface RenderOptions {
  theme?: ThemeConfig;
  useHeaderBar?: boolean;
  omitTitle?: boolean;
  /** Confine the diagram to a slide region (inches) — diagram-beside-text. */
  region?: { x: number; y: number; w: number; h: number };
  templatePath?: string;
}

export function renderDiagram(
  spec: DiagramSpec,
  options: RenderOptions = {},
): PptxGenJS {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "WIDE";

  const slide = pptx.addSlide();
  paintDiagram(new PptxDrawTarget(slide), spec, options);
  return pptx;
}

// ── Convenience Functions ──

export async function renderToBuffer(
  spec: DiagramSpec,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const pptx = renderDiagram(spec, options);
  const data = await pptx.write({ outputType: "uint8array" });
  return data as Uint8Array;
}

export async function renderToBase64(
  spec: DiagramSpec,
  options: RenderOptions = {},
): Promise<string> {
  const pptx = renderDiagram(spec, options);
  const data = await pptx.write({ outputType: "base64" });
  return data as string;
}
