/**
 * diagram-xychart.ts — Bar / line chart parser + layout + painter (a "second
 * engine"). Mirrors Mermaid `xychart-beta`: a categorical x-axis with one or
 * more numeric series, each rendered as grouped bars or a polyline. Drawn with
 * native shapes (axes, gridlines, bars, line + dots, legend) — not an image.
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import { DiagramSpecSchema, type DiagramSpec } from "./schema";
import { type ThemeConfig, bareTextColor } from "./theme";
import type { DrawTarget } from "./draw-target";
import { SLIDE_W, SLIDE_H } from "./layout-engine";

// Distinct series colours (bars + lines share the palette by series index).
const SERIES_COLORS = ["#3B82F6", "#06B6D4", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6"];

// ── parser ──
function bracketList(s: string): string[] {
  const m = s.match(/\[([^\]]*)\]/);
  return m ? m[1].split(",").map((x) => x.trim()).filter((x) => x.length > 0) : [];
}
function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, "").trim();
}

/** Parse a Mermaid `xychart-beta` into a DiagramSpec (type "xychart"). */
export function parseMermaidXychart(lines: string[]): DiagramSpec | null {
  let title: string | undefined;
  let xlabel = "";
  let ylabel = "";
  let ymin = 0;
  let ymax: number | undefined;
  let categories: string[] = [];
  const series: { kind: "bar" | "line"; name: string; values: number[] }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("%%")) continue;
    const tm = line.match(/^title\s+(.+)$/i);
    if (tm) { title = unquote(tm[1].trim()); continue; }
    if (/^x-axis\b/i.test(line)) {
      const lbl = line.match(/"([^"]*)"/);
      if (lbl) xlabel = lbl[1];
      categories = bracketList(line).map(unquote);
      continue;
    }
    if (/^y-axis\b/i.test(line)) {
      const lbl = line.match(/"([^"]*)"/);
      if (lbl) ylabel = lbl[1];
      const rng = line.match(/(-?\d+(?:\.\d+)?)\s*-->\s*(-?\d+(?:\.\d+)?)/);
      if (rng) { ymin = +rng[1]; ymax = +rng[2]; }
      continue;
    }
    const bm = line.match(/^(bar|line)\b(.*)$/i);
    if (bm) {
      const nm = bm[2].match(/"([^"]*)"/);
      const values = bracketList(bm[2]).map(Number).filter((v) => !Number.isNaN(v));
      series.push({ kind: bm[1].toLowerCase() as "bar" | "line", name: nm ? nm[1] : "", values });
    }
  }
  if (series.length === 0) return null;
  const n = Math.max(categories.length, ...series.map((s) => s.values.length));
  if (categories.length === 0) categories = Array.from({ length: n }, (_, i) => String(i + 1));

  const r = DiagramSpecSchema.safeParse({
    type: "xychart", direction: "TB", title, nodes: [], edges: [],
    xychart: { xlabel, ylabel, ymin, ymax, categories, series },
  });
  return r.success ? r.data : null;
}

/** DiagramSpec(xychart) → Mermaid `xychart-beta` text (round-trips the data). */
export function xychartSpecToMermaid(spec: DiagramSpec): string {
  const x = spec.xychart;
  let s = "xychart-beta\n";
  if (spec.title) s += `  title "${spec.title}"\n`;
  if (!x) return s;
  const xl = x.xlabel ? `"${x.xlabel}" ` : "";
  s += `  x-axis ${xl}[${x.categories.join(", ")}]\n`;
  const yr = x.ymax !== undefined ? ` ${x.ymin} --> ${x.ymax}` : "";
  s += `  y-axis "${x.ylabel}"${yr}\n`;
  for (const ser of x.series) s += `  ${ser.kind} [${ser.values.join(", ")}]\n`;
  return s;
}

// ── layout + paint ──
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * mag;
}
function fmtNum(v: number): string {
  if (Math.abs(v) >= 1000) return `${+(v / 1000).toFixed(1)}k`;
  return `${+v.toFixed(Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0)}`;
}

export interface XychartLayout {
  x0: number; x1: number; yTop: number; yBot: number;
  yticks: { y: number; label: string }[];
  bars: { x: number; y: number; w: number; h: number; color: string }[];
  polylines: { pts: { x: number; y: number }[]; color: string }[];
  xlabels: { x: number; label: string }[];
  legend: { color: string; label: string; kind: "bar" | "line" }[];
  title?: string;
  ylabel: string;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export function computeXychartLayout(spec: DiagramSpec, contentTop: number): XychartLayout {
  const x = spec.xychart;
  const cats = x?.categories ?? [];
  const series = x?.series ?? [];
  const n = Math.max(1, cats.length);

  const allVals = series.flatMap((s) => s.values);
  const ymin = x?.ymin ?? 0;
  let ymax = x?.ymax ?? niceCeil(Math.max(1, ...allVals));
  if (ymax <= ymin) ymax = ymin + 1;

  // vertical block, centred so the chart clears the slide title/subtitle
  const titleH = spec.title ? 0.4 : 0.08;
  const legendH = series.length > 1 ? 0.42 : 0.0;
  const avail = SLIDE_H - contentTop - 0.3;
  const blockH = Math.min(avail, 5.0);
  const top = contentTop + Math.max(0, (avail - blockH) / 2);

  const x0 = 0.95;
  const x1 = SLIDE_W - 0.45;
  const yTop = top + titleH;
  const yBot = top + blockH - 0.42 - legendH; // leave room for x labels + legend
  const yToPix = (v: number) => yBot - ((v - ymin) / (ymax - ymin)) * (yBot - yTop);

  // y ticks
  const step = niceCeil((ymax - ymin) / 5);
  const yticks: XychartLayout["yticks"] = [];
  for (let v = ymin; v <= ymax + 1e-9; v += step) yticks.push({ y: yToPix(v), label: fmtNum(v) });

  const slotW = (x1 - x0) / n;
  const xlabels = cats.map((c, i) => ({ x: x0 + (i + 0.5) * slotW, label: c }));

  // bars: grouped within each category slot
  const barSeries = series.map((s, gi) => ({ s, gi })).filter((o) => o.s.kind === "bar");
  const groupW = slotW * 0.66;
  const barW = barSeries.length ? groupW / barSeries.length : groupW;
  const bars: XychartLayout["bars"] = [];
  barSeries.forEach((o, bi) => {
    o.s.values.forEach((val, i) => {
      const cx = x0 + (i + 0.5) * slotW;
      const bx = cx - groupW / 2 + bi * barW;
      const vy = yToPix(Math.max(ymin, Math.min(ymax, val)));
      bars.push({ x: bx + barW * 0.08, y: vy, w: barW * 0.84, h: Math.max(0.02, yBot - vy), color: SERIES_COLORS[o.gi % SERIES_COLORS.length] });
    });
  });

  // line series → polylines through category centres
  const polylines: XychartLayout["polylines"] = series.map((s, gi) => ({ s, gi }))
    .filter((o) => o.s.kind === "line")
    .map((o) => ({
      color: SERIES_COLORS[o.gi % SERIES_COLORS.length],
      pts: o.s.values.map((val, i) => ({ x: x0 + (i + 0.5) * slotW, y: yToPix(Math.max(ymin, Math.min(ymax, val))) })),
    }));

  const legend: XychartLayout["legend"] = series.length > 1
    ? series.map((s, gi) => ({ color: SERIES_COLORS[gi % SERIES_COLORS.length], label: s.name || `${s.kind} ${gi + 1}`, kind: s.kind }))
    : [];
  const legendY = yBot + 0.32;

  return {
    x0, x1, yTop, yBot, yticks, bars, polylines, xlabels, legend, title: spec.title, ylabel: x?.ylabel ?? "",
    bbox: { minX: 0.1, minY: top - 0.05, maxX: SLIDE_W - 0.2, maxY: (legend.length ? legendY + 0.3 : yBot + 0.35) },
  };
}

export function paintXychart(dt: DrawTarget, lay: XychartLayout, theme: ThemeConfig): void {
  const fonts = theme.fonts;
  const grid = theme.diagram_style.edge_color;
  const ink = bareTextColor(theme);

  if (lay.title) {
    dt.text([{ text: lay.title, fontSize: 13, fontFace: fonts.heading, color: ink, bold: true }],
      { x: lay.x0 - 0.4, y: lay.yTop - 0.42, w: lay.x1 - lay.x0 + 0.4, h: 0.36 }, { align: "center", valign: "middle", shrink: true });
  }

  // y gridlines + labels
  for (const tk of lay.yticks) {
    dt.line({ x: lay.x0, y: tk.y }, { x: lay.x1, y: tk.y }, { color: grid, width: 0.5, dash: true, arrow: false });
    dt.text([{ text: tk.label, fontSize: 8, fontFace: fonts.body, color: ink, bold: false }],
      { x: lay.x0 - 0.85, y: tk.y - 0.12, w: 0.78, h: 0.24 }, { align: "right", valign: "middle", shrink: true });
  }
  // axes
  dt.line({ x: lay.x0, y: lay.yTop }, { x: lay.x0, y: lay.yBot }, { color: ink, width: 1, arrow: false });
  dt.line({ x: lay.x0, y: lay.yBot }, { x: lay.x1, y: lay.yBot }, { color: ink, width: 1, arrow: false });
  if (lay.ylabel) {
    dt.text([{ text: lay.ylabel, fontSize: 8, fontFace: fonts.body, color: ink, bold: false }],
      { x: lay.x0 - 0.4, y: lay.yTop - 0.26, w: 1.6, h: 0.22 }, { align: "left", valign: "middle", shrink: true });
  }

  // bars
  for (const b of lay.bars) {
    dt.shape("rect", { x: b.x, y: b.y, w: b.w, h: b.h }, { fill: b.color, line: { color: b.color, width: 0 } });
  }
  // line series: segments + dots
  for (const pl of lay.polylines) {
    dt.beginGroup();
    for (let i = 1; i < pl.pts.length; i++) {
      dt.line(pl.pts[i - 1], pl.pts[i], { color: pl.color, width: 2, arrow: false });
    }
    for (const p of pl.pts) {
      dt.shape("circle", { x: p.x - 0.05, y: p.y - 0.05, w: 0.1, h: 0.1 }, { fill: pl.color, line: { color: "#FFFFFF", width: 1 } });
    }
    dt.endGroup();
  }

  // x labels
  for (const xl of lay.xlabels) {
    dt.text([{ text: xl.label, fontSize: 9, fontFace: fonts.body, color: ink, bold: false }],
      { x: xl.x - 0.7, y: lay.yBot + 0.04, w: 1.4, h: 0.26 }, { align: "center", valign: "middle", shrink: true });
  }

  // legend (multi-series only)
  lay.legend.forEach((lg, i) => {
    const lx = lay.x0 + i * 1.7;
    const ly = lay.yBot + 0.32;
    dt.beginGroup();
    if (lg.kind === "bar") {
      dt.shape("rect", { x: lx, y: ly + 0.04, w: 0.2, h: 0.16 }, { fill: lg.color, line: { color: lg.color, width: 0 } });
    } else {
      dt.line({ x: lx, y: ly + 0.12 }, { x: lx + 0.2, y: ly + 0.12 }, { color: lg.color, width: 2, arrow: false });
      dt.shape("circle", { x: lx + 0.06, y: ly + 0.07, w: 0.1, h: 0.1 }, { fill: lg.color, line: { color: "#FFFFFF", width: 1 } });
    }
    dt.text([{ text: lg.label, fontSize: 9, fontFace: fonts.body, color: ink, bold: false }],
      { x: lx + 0.28, y: ly, w: 1.4, h: 0.26 }, { align: "left", valign: "middle", shrink: true });
    dt.endGroup();
  });
}
