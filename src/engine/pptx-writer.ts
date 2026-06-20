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

// ── Group tree ──
//
// PptxGenJS emits a FLAT list of shapes (no native grouping), so the draw target
// can't build `<p:grpSp>` directly. Instead it records a tree of group boundaries
// keyed by leaf INDEX (the i-th shape/line/text call == the i-th shape in the
// generated slide XML, since PptxGenJS preserves call order). nestShapeXml() later
// walks this tree to wrap the extracted shapes into nested groups.
export type GroupNode = { kind: "leaf"; index: number } | { kind: "group"; children: GroupNode[] };

function countLeaves(nodes: GroupNode[]): number {
  let n = 0;
  for (const node of nodes) n += node.kind === "leaf" ? 1 : countLeaves(node.children);
  return n;
}

// ── PptxGenJS draw target ──

class PptxDrawTarget implements DrawTarget {
  private slide: PptxGenJS.Slide;
  // Group tree (see GroupNode). `groups` is the root child list; `stack` tracks
  // the currently-open group's child list. Every shape/line/text appends a leaf.
  readonly groups: GroupNode[] = [];
  private leafCount = 0;
  private stack: GroupNode[][];

  constructor(slide: PptxGenJS.Slide) {
    this.slide = slide;
    this.stack = [this.groups];
  }

  private addLeaf(): void {
    this.stack[this.stack.length - 1].push({ kind: "leaf", index: this.leafCount++ });
  }

  beginGroup(): void {
    const node: GroupNode = { kind: "group", children: [] };
    this.stack[this.stack.length - 1].push(node);
    this.stack.push(node.children);
  }
  endGroup(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  background(color: string): void {
    this.slide.background = { color: hexToRgb(color) };
  }

  shape(
    kind: ShapeType,
    box: Box,
    opts: { fill: string | null; line?: LineSpec; rectRadius?: number },
  ): void {
    this.addLeaf();
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
    this.addLeaf();
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
        endArrowType: opts.arrow ? (opts.openArrow ? "arrow" : "triangle") : "none",
      },
      flipH: to.x < from.x,
      flipV: to.y < from.y,
    });
  }

  text(lines: TextRun[], box: Box, opts: TextOpts): void {
    this.addLeaf();
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

/**
 * Render a diagram AND return its group tree, so the embedded deck path
 * (placeholder-filler) can nest the loose shapes into PowerPoint groups via
 * nestShapeXml(). The standalone renderToBuffer stays flat (used by goldens).
 */
export async function renderToBufferWithGroups(
  spec: DiagramSpec,
  options: RenderOptions = {},
): Promise<{ buffer: Uint8Array; groups: GroupNode[] }> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "WIDE";
  const slide = pptx.addSlide();
  const target = new PptxDrawTarget(slide);
  paintDiagram(target, spec, options);
  const data = await pptx.write({ outputType: "uint8array" });
  return { buffer: data as Uint8Array, groups: target.groups };
}

/**
 * Wrap a flat PptxGenJS slide's shapes into nested `<p:grpSp>` groups per a group
 * tree. Shapes are matched in document order (== draw-call order == leaf index).
 * Each group's xfrm uses chOff==off / chExt==ext so children keep their absolute
 * coordinates (a pure container — no reposition/scale). Falls back to flat output
 * if the leaf count doesn't match the shapes found (defensive; never drops shapes).
 */
export function nestShapeXml(slideXml: string, groups: GroupNode[]): string {
  const shapes =
    slideXml.match(/<p:sp>[\s\S]*?<\/p:sp>|<p:cxnSp>[\s\S]*?<\/p:cxnSp>/g) ?? [];
  if (countLeaves(groups) !== shapes.length) {
    return shapes.join(""); // structure drifted — stay flat rather than corrupt output
  }
  let gid = 7000;
  type B = { x: number; y: number; w: number; h: number };
  const boxOf = (xml: string): B | null => {
    const off = xml.match(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/);
    const ext = xml.match(/<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/);
    if (!off || !ext) return null;
    return { x: +off[1], y: +off[2], w: +ext[1], h: +ext[2] };
  };
  const emit = (node: GroupNode): { xml: string; box: B | null } => {
    if (node.kind === "leaf") {
      const s = shapes[node.index];
      return { xml: s, box: boxOf(s) };
    }
    const kids = node.children.map(emit);
    const inner = kids.map((k) => k.xml).join("");
    const boxes = kids.map((k) => k.box).filter((b): b is B => b !== null);
    if (boxes.length === 0) return { xml: inner, box: null }; // nothing positioned → don't wrap
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const w = Math.max(...boxes.map((b) => b.x + b.w)) - x;
    const h = Math.max(...boxes.map((b) => b.y + b.h)) - y;
    const id = gid++;
    const xml =
      `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="g${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      `<p:grpSpPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/>` +
      `<a:chOff x="${x}" y="${y}"/><a:chExt cx="${w}" cy="${h}"/></a:xfrm></p:grpSpPr>` +
      inner +
      `</p:grpSp>`;
    return { xml, box: { x, y, w, h } };
  };
  return groups.map((n) => emit(n).xml).join("");
}
