/**
 * diagram-pie.ts — Pie-chart layout + painter (a "second engine" like
 * diagram-timeline / diagram-quadrant). Slices are nodes (label + value); each
 * is drawn as a native wedge (DrawTarget.wedge → PPTX `pie` shape + preview SVG
 * path) with a % label, plus a colour-swatch legend. WYSIWYG, not an image.
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import type { DiagramSpec } from "./schema";
import { type ThemeConfig, bareTextColor } from "./theme";
import type { DrawTarget } from "./draw-target";
import { SLIDE_W, SLIDE_H } from "./layout-engine";

// Distinct, dark-theme-friendly slice colours (cycled).
const PIE_COLORS = [
  "#3B82F6", "#06B6D4", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#F97316", "#14B8A6", "#A3A3A3",
];

export interface PieLayout {
  cx: number;
  cy: number;
  r: number;
  slices: { startDeg: number; endDeg: number; midDeg: number; color: string; label: string; value: number; pct: number }[];
  legendX: number;
  legendY: number;
  legendStep: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export function computePieLayout(spec: DiagramSpec, contentTop: number): PieLayout {
  const raw = spec.nodes.filter((n) => (n.value ?? 0) > 0).map((n) => ({ label: n.label, value: n.value! }));
  const total = raw.reduce((s, x) => s + x.value, 0) || 1;
  const availH = SLIDE_H - contentTop - 0.4;
  const r = Math.max(1.2, Math.min(availH / 2 - 0.1, 2.4));
  const cy = contentTop + availH / 2;
  const cx = 0.6 + r; // pie on the left, legend to its right

  let acc = 0;
  const startBase = 270; // start at 12 o'clock (0 = East, increasing clockwise)
  const slices = raw.map((s, i) => {
    const frac = s.value / total;
    const a0 = startBase + acc * 360;
    const a1 = startBase + (acc + frac) * 360;
    acc += frac;
    return {
      startDeg: a0, endDeg: a1, midDeg: (a0 + a1) / 2,
      color: PIE_COLORS[i % PIE_COLORS.length],
      label: s.label, value: s.value, pct: frac * 100,
    };
  });

  const legendStep = Math.min(0.42, Math.max(0.3, (2 * r) / Math.max(slices.length, 1)));
  const legendX = cx + r + 0.5;
  const legendY = cy - (slices.length * legendStep) / 2;
  return {
    cx, cy, r, slices, legendX, legendY, legendStep,
    bbox: { minX: cx - r - 0.1, minY: cy - r - 0.1, maxX: SLIDE_W - 0.4, maxY: cy + r + 0.1 },
  };
}

export function paintPie(dt: DrawTarget, lay: PieLayout, theme: ThemeConfig): void {
  const fonts = theme.fonts;
  const sep = theme.diagram_style.slide_bg ?? "#0A0E27"; // thin separator between slices
  const onSlice = "#FFFFFF"; // text drawn ON a coloured slice
  const ink = bareTextColor(theme); // bare text on the slide bg (contrast-derived)
  const { cx, cy, r } = lay;

  // slices: each wedge + its % label, grouped
  for (const s of lay.slices) {
    dt.beginGroup();
    dt.wedge(cx, cy, r, s.startDeg, s.endDeg, { fill: s.color, line: { color: sep, width: 1.25 } });
    if (s.pct >= 4) {
      const rad = (s.midDeg * Math.PI) / 180;
      const lx = cx + r * 0.62 * Math.cos(rad);
      const ly = cy + r * 0.62 * Math.sin(rad);
      dt.text(
        [{ text: `${Math.round(s.pct)}%`, fontSize: 10, fontFace: fonts.body, color: onSlice, bold: true }],
        { x: lx - 0.4, y: ly - 0.14, w: 0.8, h: 0.28 },
        { align: "center", valign: "middle", shrink: true },
      );
    }
    dt.endGroup();
  }

  // legend: colour swatch + "label  value", one row per slice
  lay.slices.forEach((s, i) => {
    const y = lay.legendY + i * lay.legendStep;
    dt.beginGroup();
    dt.shape("rect", { x: lay.legendX, y: y + lay.legendStep / 2 - 0.09, w: 0.18, h: 0.18 }, { fill: s.color, line: { color: s.color, width: 0 } });
    dt.text(
      [{ text: `${s.label}  ${s.value}`, fontSize: 10, fontFace: fonts.body, color: ink, bold: false }],
      { x: lay.legendX + 0.28, y, w: SLIDE_W - lay.legendX - 0.5, h: lay.legendStep },
      { align: "left", valign: "middle", shrink: true },
    );
    dt.endGroup();
  });
}
