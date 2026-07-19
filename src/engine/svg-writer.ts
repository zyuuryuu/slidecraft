/**
 * svg-writer.ts — SVG backend for the shared diagram painter.
 *
 * Renders a DiagramSpec to an SVG string using the SAME geometry + draw
 * orchestration as the PPTX exporter (diagram-painter.ts → paintDiagram).
 * This is what the live preview uses, so preview == PPTX by construction.
 *
 * Coordinates from the painter are in inches; we scale to px for the SVG
 * viewBox. Font/stroke sizes are in points (pt → px at 96dpi = ×4/3).
 */

import type { DiagramSpec, ShapeType } from "./schema";
import { SLIDE_W, SLIDE_H, type ConnectionPoint } from "./layout-engine";
import { cjkFontFamily } from "./font-stack";
import {
  paintDiagram,
  type DrawTarget,
  type Box,
  type LineSpec,
  type TextRun,
  type TextOpts,
  type EdgeLineOpts,
  type PaintOptions,
} from "./diagram-painter";
import { shrinkScale, wrapToWidth } from "./draw-target";

// Re-export so existing consumers/tests keep their import path (moved to draw-target in #228).
export { wrapToWidth } from "./draw-target";

const SCALE = 96; // px per inch
const PT = 96 / 72; // pt → px

function px(inches: number): number {
  return Math.round(inches * SCALE * 100) / 100;
}

function col(c: string): string {
  // esc() too: colors come from untrusted deck data and land in style="…" / fill="…"
  // attributes — a value like `red" onmouseover=…` would otherwise break out.
  return esc(c.startsWith("#") ? c : `#${c}`);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;"); // also escape ' so a value in a future single-quoted attr can't break out (ADR-0016 F4)
}

class SvgDrawTarget implements DrawTarget {
  private parts: string[] = [];
  private bg = "#0A0E27";
  private drawBg: boolean;
  // Stack of part-array indices marking where each open group started.
  private groupStarts: number[] = [];

  constructor(transparent = false) {
    this.drawBg = !transparent;
  }

  background(color: string): void {
    this.bg = col(color);
  }

  beginGroup(): void {
    this.groupStarts.push(this.parts.length);
  }
  endGroup(): void {
    const start = this.groupStarts.pop();
    if (start === undefined) return;
    const kids = this.parts.splice(start);
    if (kids.length) this.parts.push(`<g>${kids.join("")}</g>`);
  }

  shape(
    kind: ShapeType,
    box: Box,
    opts: { fill: string | null; line?: LineSpec; rectRadius?: number },
  ): void {
    const x = px(box.x);
    const y = px(box.y);
    const w = px(box.w);
    const h = px(box.h);
    const fill = opts.fill === null ? "none" : col(opts.fill);

    let stroke = "";
    if (opts.line && opts.line.width > 0 && opts.line.color !== undefined) {
      const sw = Math.max(opts.line.width * PT, 0.5);
      stroke = ` stroke="${col(opts.line.color)}" stroke-width="${sw}"`;
      if (opts.line.dash) stroke += ` stroke-dasharray="6,4"`;
    }

    this.parts.push(this.shapeEl(kind, x, y, w, h, fill, stroke, opts.rectRadius));
  }

  private shapeEl(
    kind: ShapeType,
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    stroke: string,
    rectRadius?: number,
  ): string {
    const cx = x + w / 2;
    const cy = y + h / 2;
    switch (kind) {
      case "diamond":
        return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${fill}"${stroke}/>`;
      case "circle":
      case "oval":
        return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"${stroke}/>`;
      case "hexagon": {
        const inset = Math.min(w * 0.25, h * 0.5);
        const pts = `${x + inset},${y} ${x + w - inset},${y} ${x + w},${cy} ${x + w - inset},${y + h} ${x + inset},${y + h} ${x},${cy}`;
        return `<polygon points="${pts}" fill="${fill}"${stroke}/>`;
      }
      case "rounded_rect": {
        const rx = rectRadius !== undefined ? px(rectRadius) : Math.min(w, h) * 0.18;
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="${fill}"${stroke}/>`;
      }
      default: {
        const rx = rectRadius !== undefined ? px(rectRadius) : 0;
        const r = rx ? ` rx="${rx}" ry="${rx}"` : "";
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}"${r} fill="${fill}"${stroke}/>`;
      }
    }
  }

  line(from: ConnectionPoint, to: ConnectionPoint, opts: EdgeLineOpts): void {
    const x1 = px(from.x);
    const y1 = px(from.y);
    const x2 = px(to.x);
    const y2 = px(to.y);
    const c = col(opts.color);
    const sw = Math.max(opts.width * PT, 0.5);
    const dash = opts.dash ? ` stroke-dasharray="6,4"` : "";
    this.parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${sw}"${dash} stroke-linecap="round"/>`,
    );

    if (opts.arrow) {
      // Manual arrowhead (robust across WebKit/Chromium — no marker support needed)
      let dx = x2 - x1;
      let dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const s = 9;
      const p1x = x2 - dx * s - dy * s * 0.5;
      const p1y = y2 - dy * s + dx * s * 0.5;
      const p2x = x2 - dx * s + dy * s * 0.5;
      const p2y = y2 - dy * s - dx * s * 0.5;
      if (opts.openArrow) {
        // Open (line) arrowhead — two strokes forming a ">" (async messages).
        const sw2 = Math.max(opts.width * PT, 1);
        this.parts.push(
          `<polyline points="${p1x.toFixed(1)},${p1y.toFixed(1)} ${x2},${y2} ${p2x.toFixed(1)},${p2y.toFixed(1)}" ` +
            `fill="none" stroke="${c}" stroke-width="${sw2}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
      } else {
        this.parts.push(
          `<polygon points="${x2},${y2} ${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)}" fill="${c}"/>`,
        );
      }
    }
  }

  /**
   * Native SVG <text>/<tspan> — survives <canvas> rasterization and WebKitGTK/headless
   * print-to-PDF (both drop <foreignObject>). Each TextRun is one pre-split line
   * (draw-target.ts), dy-stacked; opts.wrap labels are soft-wrapped via wrapToWidth so
   * they don't overflow where the old <div> used to wrap. Preview + HTML export share
   * this one output, so they stay WYSIWYG-identical and both print robustly.
   */
  text(lines: TextRun[], box: Box, opts: TextOpts): void {
    if (lines.length === 0) return;
    const x = px(box.x);
    const y = px(box.y);
    const w = px(box.w);
    const h = px(box.h);
    const pad = 1; // matches the old foreignObject padding:1px
    const LH = 1.15; // line-height (PPTX-parity metric)
    const ASCENT = 0.875; // baseline below line top; absorbs the half-leading the old flex box added

    const anchor = opts.align === "left" ? "start" : opts.align === "right" ? "end" : "middle";
    const tx = opts.align === "left" ? x + pad : opts.align === "right" ? x + w - pad : x + w / 2;
    const maxW = Math.max(w - 2 * pad, 1);

    // Expand runs into visual lines (soft-wrap only when opts.wrap is set), keeping each
    // run's font size/weight/color/family so a bold label over a plain sublabel stays styled.
    // Drop empty pieces so a blank run doesn't consume a phantom line and mis-centre the block.
    const vlines: Array<{ text: string; fs: number; weight: string; fill: string; face: string }> = [];
    for (const r of lines) {
      const fs = Math.round(r.fontSize * PT * 10) / 10;
      const weight = r.bold ? "700" : "400";
      const fill = col(r.color);
      const face = esc(cjkFontFamily(r.fontFace));
      const pieces = opts.wrap ? wrapToWidth(r.text, maxW, fs) : [r.text];
      for (const p of pieces) if (p !== "") vlines.push({ text: p, fs, weight, fill, face });
    }
    if (vlines.length === 0) return;

    // Shrink-to-fit width (honours opts.shrink; mirrors PowerPoint fit:"shrink"). SVG <text> has
    // no overflow:hidden, so without this a too-long label would spill over neighbours — the old
    // foreignObject clipped it. Scale every line's font size by the widest line's overflow ratio.
    if (opts.shrink) {
      const s = shrinkScale(vlines, maxW); // shared with the PPTX writer's pre-shrink (#228, R8)
      if (s < 1) for (const l of vlines) l.fs = Math.round(l.fs * s * 100) / 100;
    }

    const lineHs = vlines.map((l) => l.fs * LH);
    const blockH = lineHs.reduce((a, b) => a + b, 0);
    let cursor = opts.valign === "top" ? y + pad : y + (h - blockH) / 2; // centre the block for middle

    const tspans = vlines
      .map((l, i) => {
        const baseline = Math.round((cursor + l.fs * ASCENT) * 100) / 100;
        cursor += lineHs[i];
        return (
          `<tspan x="${tx}" y="${baseline}" font-size="${l.fs}px" font-weight="${l.weight}" ` +
          `fill="${l.fill}" font-family="${l.face}">${esc(l.text)}</tspan>`
        );
      })
      .join("");

    this.parts.push(`<text text-anchor="${anchor}">${tspans}</text>`);
  }

  wedge(
    cx: number, cy: number, r: number, startDeg: number, endDeg: number,
    opts: { fill: string; line?: LineSpec },
  ): void {
    const rad = (d: number) => (d * Math.PI) / 180;
    const x1 = px(cx + r * Math.cos(rad(startDeg)));
    const y1 = px(cy + r * Math.sin(rad(startDeg)));
    const x2 = px(cx + r * Math.cos(rad(endDeg)));
    const y2 = px(cy + r * Math.sin(rad(endDeg)));
    const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0; // sweep=1 = clockwise (matches PPTX)
    let stroke = "";
    if (opts.line && opts.line.width > 0 && opts.line.color !== undefined) {
      stroke = ` stroke="${col(opts.line.color)}" stroke-width="${Math.max(opts.line.width * PT, 0.5)}"`;
    }
    this.parts.push(
      `<path d="M ${px(cx)} ${px(cy)} L ${x1} ${y1} A ${px(r)} ${px(r)} 0 ${largeArc} 1 ${x2} ${y2} Z" ` +
        `fill="${col(opts.fill)}"${stroke}/>`,
    );
  }

  toSvg(): string {
    const W = px(SLIDE_W);
    const H = px(SLIDE_H);
    const bgRect = this.drawBg ? `<rect x="0" y="0" width="${W}" height="${H}" fill="${this.bg}"/>` : "";
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ` +
      `width="100%" height="100%" preserveAspectRatio="xMidYMid meet">` +
      bgRect +
      this.parts.join("") +
      `</svg>`
    );
  }
}

export interface SvgRenderOptions extends PaintOptions {
  /**
   * Skip the slide-background rect. The PPTX export overlays only the diagram
   * SHAPES (its background is never extracted), so the preview overlay must be
   * transparent to match what actually lands in the slide.
   */
  transparent?: boolean;
}

/** Render a DiagramSpec to an SVG string (preview), matching the PPTX export. */
export function renderDiagramToSvg(spec: DiagramSpec, options: SvgRenderOptions = {}): string {
  const target = new SvgDrawTarget(options.transparent);
  paintDiagram(target, spec, options);
  return target.toSvg();
}
