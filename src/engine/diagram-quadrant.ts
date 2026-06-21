/**
 * diagram-quadrant.ts — Quadrant-chart layout + painter (a "second engine" like
 * diagram-timeline). A 2x2 matrix: a square split by a centre cross into four
 * labelled quadrants (q1=top-right … q4=bottom-right), x/y axis labels, and
 * plotted points at normalised [0,1] coordinates. Rendered via the shared
 * DrawTarget → native PPTX shapes + preview SVG (WYSIWYG), not a Mermaid image.
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import type { DiagramSpec } from "./schema";
import type { ThemeConfig } from "./theme";
import type { DrawTarget } from "./draw-target";
import { SLIDE_W, SLIDE_H } from "./layout-engine";

export interface QuadrantLayout {
  x0: number;
  y0: number;
  size: number;
  points: { px: number; py: number; label: string }[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function computeQuadrantLayout(spec: DiagramSpec, contentTop: number): QuadrantLayout {
  const size = Math.max(2, Math.min(SLIDE_H - contentTop - 1.0, 4.8));
  const totalH = size + 0.45; // chart + x-axis label band
  const avail = SLIDE_H - contentTop - 0.3;
  const y0 = contentTop + Math.max(0, (avail - totalH) / 2);
  const x0 = (SLIDE_W - size) / 2 + 0.3; // shift right to leave room for y-axis labels

  const points = (spec.quadrant?.points ?? []).map((p) => ({
    px: x0 + clamp01(p.x) * size,
    py: y0 + (1 - clamp01(p.y)) * size, // y inverted: 1 = top
    label: p.label,
  }));

  return {
    x0, y0, size, points,
    bbox: { minX: x0 - 0.78, minY: y0 - 0.1, maxX: x0 + size + 0.1, maxY: y0 + totalH + 0.1 },
  };
}

export function paintQuadrant(dt: DrawTarget, lay: QuadrantLayout, theme: ThemeConfig, q: DiagramSpec["quadrant"]): void {
  const fonts = theme.fonts;
  const accent = theme.palette.accent;
  const navy = theme.palette.navy;
  const textColor = "#FFFFFF"; // point labels ON the navy cells
  const ink = theme.palette.dark_text; // axis labels on the bare (light) slide bg
  const { x0, y0, size } = lay;
  const half = size / 2;

  // four quadrant cells (q2=TL, q1=TR, q3=BL, q4=BR), each with its label
  const cells = [
    { x: x0, y: y0, label: q?.q2 ?? "" },
    { x: x0 + half, y: y0, label: q?.q1 ?? "" },
    { x: x0, y: y0 + half, label: q?.q3 ?? "" },
    { x: x0 + half, y: y0 + half, label: q?.q4 ?? "" },
  ];
  for (const c of cells) {
    dt.beginGroup();
    dt.shape("rect", { x: c.x, y: c.y, w: half, h: half }, { fill: navy, line: { color: accent, width: 0.75 } });
    if (c.label) {
      dt.text(
        [{ text: c.label, fontSize: 11, fontFace: fonts.heading, color: accent, bold: true }],
        { x: c.x + 0.1, y: c.y + 0.1, w: half - 0.2, h: 0.5 },
        { align: "center", valign: "top", shrink: true, wrap: true },
      );
    }
    dt.endGroup();
  }

  // centre cross (the two axes), bolder than the cell borders
  dt.line({ x: x0, y: y0 + half }, { x: x0 + size, y: y0 + half }, { color: accent, width: 1.75, arrow: false });
  dt.line({ x: x0 + half, y: y0 }, { x: x0 + half, y: y0 + size }, { color: accent, width: 1.75, arrow: false });

  // axis labels (x: low-left / high-right below; y: high-top / low-bottom on the left)
  const axisT = (text: string, box: { x: number; y: number; w: number; h: number }, align: "left" | "right") =>
    dt.text([{ text, fontSize: 10, fontFace: fonts.body, color: ink, bold: false }], box, { align, valign: "middle", shrink: true });
  if (q?.xLow) axisT(q.xLow, { x: x0, y: y0 + size + 0.06, w: half, h: 0.34 }, "left");
  if (q?.xHigh) axisT(q.xHigh, { x: x0 + half, y: y0 + size + 0.06, w: half, h: 0.34 }, "right");
  if (q?.yHigh) axisT(q.yHigh, { x: x0 - 0.74, y: y0 + 0.04, w: 0.68, h: 0.34 }, "right");
  if (q?.yLow) axisT(q.yLow, { x: x0 - 0.74, y: y0 + size - 0.38, w: 0.68, h: 0.34 }, "right");

  // plotted points: a dot + its label (each its own sub-group)
  for (const p of lay.points) {
    dt.beginGroup();
    const r = 0.07;
    dt.shape("circle", { x: p.px - r, y: p.py - r, w: 2 * r, h: 2 * r }, { fill: accent, line: { color: accent, width: 0 } });
    dt.text(
      [{ text: p.label, fontSize: 9, fontFace: fonts.body, color: textColor, bold: false }],
      { x: p.px + 0.1, y: p.py - 0.12, w: 1.7, h: 0.24 },
      { align: "left", valign: "middle", shrink: true },
    );
    dt.endGroup();
  }
}
