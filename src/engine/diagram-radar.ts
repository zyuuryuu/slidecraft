/**
 * diagram-radar.ts — Radar / spider chart layout + painter (a "second engine").
 *
 * N axes radiating from a centre; each series gives one value per axis (0..max)
 * and is drawn as a closed outline + vertex dots over concentric grid rings.
 * Native shapes (lines + dots + labels), not an image. No Mermaid equivalent —
 * authored as a DiagramSpec (type "radar").
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import type { DiagramSpec } from "./schema";
import { type ThemeConfig, bareTextColor } from "./theme";
import type { DrawTarget } from "./draw-target";
import { SLIDE_W, SLIDE_H } from "./layout-engine";

const SERIES_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#06B6D4"];
const RINGS = 4;

type Pt = { x: number; y: number };

export interface RadarLayout {
  rings: Pt[][];
  spokes: { from: Pt; to: Pt }[];
  axisLabels: { x: number; y: number; label: string }[];
  series: { color: string; name: string; pts: Pt[] }[];
  legend: { color: string; label: string }[];
  legendY: number;
  title?: string;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export function computeRadarLayout(spec: DiagramSpec, contentTop: number): RadarLayout {
  const r = spec.radar;
  const axes = r?.axes ?? [];
  const n = Math.max(3, axes.length); // a polygon needs ≥3 axes
  const max = r?.max && r.max > 0 ? r.max : 5;
  const series = r?.series ?? [];

  const titleH = spec.title ? 0.4 : 0.1;
  const legendH = series.length > 1 ? 0.45 : 0;
  const avail = SLIDE_H - contentTop - 0.3;
  const R = Math.max(1.2, Math.min((SLIDE_W - 3.6) / 2, (avail - titleH - legendH - 1.0) / 2, 2.5));
  const blockH = titleH + 2 * R + 0.9 + legendH;
  const top = contentTop + Math.max(0, (avail - blockH) / 2);
  const cx = SLIDE_W / 2;
  const cy = top + titleH + R + 0.45;

  const ang = (k: number) => -Math.PI / 2 + (k * 2 * Math.PI) / n; // axis 0 at top, clockwise
  const at = (k: number, rad: number): Pt => ({ x: cx + rad * Math.cos(ang(k)), y: cy + rad * Math.sin(ang(k)) });

  const rings: Pt[][] = [];
  for (let g = 1; g <= RINGS; g++) {
    const rr = (g / RINGS) * R;
    rings.push(Array.from({ length: n }, (_, k) => at(k, rr)));
  }
  const spokes = Array.from({ length: n }, (_, k) => ({ from: { x: cx, y: cy }, to: at(k, R) }));
  const axisLabels = axes.map((label, k) => {
    const p = at(k, R + 0.28);
    return { x: p.x, y: p.y, label };
  });

  const radarSeries = series.map((s, si) => ({
    color: SERIES_COLORS[si % SERIES_COLORS.length],
    name: s.name || `系列 ${si + 1}`,
    pts: Array.from({ length: n }, (_, k) => at(k, (Math.max(0, Math.min(max, s.values[k] ?? 0)) / max) * R)),
  }));

  const legend = series.length > 1 ? radarSeries.map((s) => ({ color: s.color, label: s.name })) : [];
  const legendY = cy + R + 0.55;

  return {
    rings, spokes, axisLabels, series: radarSeries, legend, legendY, title: spec.title,
    bbox: { minX: cx - R - 1.1, minY: top - 0.05, maxX: cx + R + 1.1, maxY: (legend.length ? legendY + 0.3 : cy + R + 0.55) },
  };
}

function closedLoop(dt: DrawTarget, pts: Pt[], color: string, width: number): void {
  for (let i = 0; i < pts.length; i++) {
    dt.line(pts[i], pts[(i + 1) % pts.length], { color, width, arrow: false });
  }
}

export function paintRadar(dt: DrawTarget, lay: RadarLayout, theme: ThemeConfig): void {
  const fonts = theme.fonts;
  const grid = theme.diagram_style.edge_color;
  const ink = bareTextColor(theme);

  if (lay.title) {
    dt.text([{ text: lay.title, fontSize: 13, fontFace: fonts.heading, color: ink, bold: true }],
      { x: lay.bbox.minX, y: lay.bbox.minY, w: lay.bbox.maxX - lay.bbox.minX, h: 0.36 }, { align: "center", valign: "middle", shrink: true });
  }

  // concentric grid rings + spokes (faint)
  for (const ring of lay.rings) closedLoop(dt, ring, grid, 0.5);
  for (const sp of lay.spokes) dt.line(sp.from, sp.to, { color: grid, width: 0.5, arrow: false });

  // axis labels
  for (const a of lay.axisLabels) {
    dt.text([{ text: a.label, fontSize: 9, fontFace: fonts.body, color: ink, bold: false }],
      { x: a.x - 0.9, y: a.y - 0.13, w: 1.8, h: 0.26 }, { align: "center", valign: "middle", shrink: true });
  }

  // series: closed outline + vertex dots, grouped per series
  for (const s of lay.series) {
    dt.beginGroup();
    closedLoop(dt, s.pts, s.color, 2);
    for (const p of s.pts) {
      dt.shape("circle", { x: p.x - 0.05, y: p.y - 0.05, w: 0.1, h: 0.1 }, { fill: s.color, line: { color: "#FFFFFF", width: 1 } });
    }
    dt.endGroup();
  }

  // legend (multi-series)
  lay.legend.forEach((lg, i) => {
    const lx = lay.bbox.minX + 0.6 + i * 1.7;
    dt.beginGroup();
    dt.shape("rect", { x: lx, y: lay.legendY + 0.04, w: 0.2, h: 0.16 }, { fill: lg.color, line: { color: lg.color, width: 0 } });
    dt.text([{ text: lg.label, fontSize: 9, fontFace: fonts.body, color: ink, bold: false }],
      { x: lx + 0.28, y: lay.legendY, w: 1.4, h: 0.26 }, { align: "left", valign: "middle", shrink: true });
    dt.endGroup();
  });
}
