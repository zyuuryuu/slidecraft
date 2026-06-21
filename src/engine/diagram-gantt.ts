/**
 * diagram-gantt.ts — Gantt-chart parser + layout + painter (a "second engine").
 *
 * Tasks carry start/end as DAY OFFSETS from the project start; the parser resolves
 * Mermaid dates / `30d` durations / `after <id>` deps into offsets. Rendered as a
 * date axis + section header bands + task bars (rounded rects; diamonds for
 * milestones), coloured by status (done/active/crit). Native shapes, not an image.
 *
 * Pure logic (R2): no DOM / Tauri. Dates via Date.UTC (deterministic, TZ-free).
 */

import { DiagramSpecSchema, type DiagramSpec } from "./schema";
import { type ThemeConfig, bareTextColor } from "./theme";
import type { DrawTarget } from "./draw-target";
import { SLIDE_W, SLIDE_H } from "./layout-engine";

// ── date helpers (deterministic, timezone-independent) ──
function dateToDay(s: string): number | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
}
function dayToISO(day: number): string {
  const d = new Date(day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function offsetToMD(startDate: string, offset: number): string {
  const base = dateToDay(startDate);
  if (base === null) return String(offset);
  const d = new Date((base + offset) * 86400000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// ── parser ──
const GANTT_STATUS = new Set(["done", "active", "crit", "milestone"]);

/** Parse a Mermaid `gantt` into a DiagramSpec (type "gantt"). Resolves dates,
 *  `Nd`/`Nw` durations and `after <id>` deps into day offsets from the earliest. */
export function parseMermaidGantt(lines: string[]): DiagramSpec | null {
  let title: string | undefined;
  let section = "";
  const raw: Array<{ name: string; section: string; status: string; startAbs: number; endAbs: number }> = [];
  const idEnd = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("%%")) continue;
    const t = line.match(/^title\s+(.+)$/i);
    if (t) { title = t[1].trim(); continue; }
    if (/^(dateFormat|axisFormat|excludes|todayMarker|tickInterval|weekday)\b/i.test(line)) continue;
    const sec = line.match(/^section\s+(.+)$/i);
    if (sec) { section = sec[1].trim(); continue; }
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    const def = line.slice(colon + 1).trim();
    if (!name || !def) continue;

    const parts = def.split(",").map((s) => s.trim()).filter(Boolean);
    let status = "";
    let id = "";
    let startAbs: number | null = null;
    let dur: number | null = null;
    const dates: number[] = [];
    for (const p of parts) {
      const lp = p.toLowerCase();
      if (GANTT_STATUS.has(lp)) { status = status ? `${status} ${lp}` : lp; continue; }
      const after = p.match(/^after\s+(\w+)$/i);
      if (after) { const e = idEnd.get(after[1]); if (e !== undefined) startAbs = e; continue; }
      const dm = p.match(/^(\d+)\s*([dwh])$/i);
      if (dm) { const n = +dm[1]; dur = dm[2].toLowerCase() === "w" ? n * 7 : dm[2].toLowerCase() === "h" ? Math.max(1, Math.round(n / 24)) : n; continue; }
      const d = dateToDay(p);
      if (d !== null) { dates.push(d); continue; }
      if (/^\w+$/.test(p) && !id) id = p;
    }
    if (dates.length >= 1 && startAbs === null) startAbs = dates[0];
    if (startAbs === null) startAbs = raw.length ? raw[raw.length - 1].endAbs : 0;
    const endAbs = dates.length >= 2 ? dates[1] : startAbs + (dur ?? 1);
    raw.push({ name, section, status, startAbs, endAbs });
    if (id) idEnd.set(id, endAbs);
  }
  if (raw.length === 0) return null;
  const minDay = Math.min(...raw.map((t) => t.startAbs));
  const tasks = raw.map((t) => ({ name: t.name, section: t.section, start: t.startAbs - minDay, end: t.endAbs - minDay, status: t.status }));
  const r = DiagramSpecSchema.safeParse({ type: "gantt", direction: "TB", title, nodes: [], edges: [], gantt: { startDate: dayToISO(minDay), tasks } });
  return r.success ? r.data : null;
}

/** DiagramSpec(gantt) → Mermaid `gantt` text. Offsets become explicit dates +
 *  `Nd` durations (so the spec — and thus the chart — round-trips losslessly). */
export function ganttSpecToMermaid(spec: DiagramSpec): string {
  const g = spec.gantt;
  let s = "gantt\n";
  if (spec.title) s += `  title ${spec.title}\n`;
  s += `  dateFormat YYYY-MM-DD\n`;
  const base = dateToDay(g?.startDate ?? "");
  let section: string | null = null;
  for (const t of g?.tasks ?? []) {
    if (t.section !== section) { section = t.section; if (section) s += `  section ${section}\n`; }
    const startISO = base === null ? "" : dayToISO(base + t.start);
    const tags = t.status ? `${t.status.split(/\s+/).join(", ")}, ` : "";
    s += `    ${t.name} : ${tags}${startISO}, ${t.end - t.start}d\n`; // exact (0d milestones round-trip)
  }
  return s;
}

// ── layout + paint ──
function statusColor(status: string): string {
  if (status.includes("crit")) return "#EF4444";
  if (status.includes("active")) return "#06B6D4";
  if (status.includes("done")) return "#64748B";
  return "#3B82F6";
}

export interface GanttLayout {
  axisY: number;
  axisX0: number;
  axisX1: number;
  ticks: { x: number; label: string }[];
  sections: { y: number; h: number; label: string }[];
  bars: { x: number; y: number; w: number; h: number; rowY: number; rowH: number; label: string; color: string; milestone: boolean; days: number }[];
  legend: { color: string; label: string }[];
  legendY: number;
  labelColW: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

// Pick a "nice" tick interval (days) giving ≤8 ticks across the span.
function niceInterval(maxDay: number): number {
  for (const c of [1, 2, 3, 7, 14, 30, 60, 90, 180]) if (maxDay / c <= 8) return c;
  return 365;
}

const STATUS_LEGEND: { key: string; label: string; color: string }[] = [
  { key: "", label: "予定", color: "#3B82F6" },
  { key: "active", label: "進行中", color: "#06B6D4" },
  { key: "done", label: "完了", color: "#64748B" },
  { key: "crit", label: "重要", color: "#EF4444" },
];

export function computeGanttLayout(spec: DiagramSpec, contentTop: number): GanttLayout {
  const g = spec.gantt;
  const tasks = g?.tasks ?? [];
  const labelColW = 2.0;
  const chartX0 = labelColW + 0.4;
  const chartX1 = SLIDE_W - 0.4;
  const chartW = chartX1 - chartX0;
  const maxDay = Math.max(1, ...tasks.map((t) => t.end));
  const interval = niceInterval(maxDay);
  const chartMaxDay = Math.ceil(maxDay / interval) * interval; // round up so the last tick aligns with the edge
  const dayToX = (d: number) => chartX0 + (d / chartMaxDay) * chartW;

  // count rows (a section header row precedes each section's tasks) + row height
  let nRows = 0;
  let lastSec: string | null = null;
  for (const t of tasks) { if (t.section !== lastSec) { nRows++; lastSec = t.section; } nRows++; }
  const rowH = Math.max(0.26, Math.min(0.42, (SLIDE_H - contentTop - 1.2) / Math.max(nRows, 1)));

  // status legend — only the statuses actually used (computed early for block height)
  const used = new Set<string>();
  for (const t of tasks) {
    if (t.status.includes("milestone")) continue;
    used.add(t.status.includes("crit") ? "crit" : t.status.includes("active") ? "active" : t.status.includes("done") ? "done" : "");
  }
  const legend = STATUS_LEGEND.filter((l) => used.has(l.key));

  // Centre the whole block vertically so the date axis at the TOP clears the
  // slide's title/subtitle (top-aligning put the date labels over the header).
  const blockH = 0.6 + nRows * rowH + (legend.length ? 0.5 : 0.15);
  const avail = SLIDE_H - contentTop - 0.3;
  const top = blockH < avail ? contentTop + (avail - blockH) / 2 : contentTop;
  const axisY = top + 0.15;
  const rowsTop = axisY + 0.45;

  const ticks: GanttLayout["ticks"] = [];
  for (let d = 0; d <= chartMaxDay; d += interval) ticks.push({ x: dayToX(d), label: offsetToMD(g?.startDate ?? "", d) });

  const sections: GanttLayout["sections"] = [];
  const bars: GanttLayout["bars"] = [];
  let row = 0;
  lastSec = null;
  for (const t of tasks) {
    if (t.section !== lastSec) {
      if (t.section) sections.push({ y: rowsTop + row * rowH, h: rowH, label: t.section });
      row++;
      lastSec = t.section;
    }
    const rowY = rowsTop + row * rowH;
    const x = dayToX(t.start);
    const w = Math.max(0.08, dayToX(t.end) - x);
    bars.push({
      x, y: rowY + rowH * 0.18, w, h: rowH * 0.64, rowY, rowH,
      label: t.name, color: statusColor(t.status), milestone: t.status.includes("milestone"), days: t.end - t.start,
    });
    row++;
  }

  const legendY = rowsTop + nRows * rowH + 0.14;

  return {
    axisY, axisX0: chartX0, axisX1: chartX1, ticks, sections, bars, legend, legendY, labelColW,
    bbox: { minX: 0.1, minY: top - 0.05, maxX: SLIDE_W - 0.2, maxY: legendY + (legend.length ? 0.4 : 0.1) },
  };
}

export function paintGantt(dt: DrawTarget, lay: GanttLayout, theme: ThemeConfig): void {
  const fonts = theme.fonts;
  const accent = theme.palette.accent;
  const grid = theme.diagram_style.edge_color;
  const ink = bareTextColor(theme); // bare text on the slide bg (contrast-derived)

  // date axis: a solid baseline + tick marks + dark labels; faint gridlines down
  const baseY = lay.axisY + 0.3;
  dt.line({ x: lay.axisX0, y: baseY }, { x: lay.axisX1, y: baseY }, { color: ink, width: 1, arrow: false });
  for (const tk of lay.ticks) {
    dt.line({ x: tk.x, y: baseY }, { x: tk.x, y: lay.bbox.maxY - 0.05 }, { color: grid, width: 0.5, dash: true, arrow: false });
    dt.line({ x: tk.x, y: baseY }, { x: tk.x, y: baseY + 0.06 }, { color: ink, width: 1, arrow: false });
    dt.text([{ text: tk.label, fontSize: 9, fontFace: fonts.body, color: ink, bold: false }],
      { x: tk.x - 0.4, y: lay.axisY - 0.02, w: 0.8, h: 0.24 }, { align: "center", valign: "middle", shrink: true });
  }

  // section headers: a dark bold name + a thin accent underline (light, not a heavy band)
  for (const s of lay.sections) {
    dt.beginGroup();
    dt.text([{ text: s.label, fontSize: 11, fontFace: fonts.heading, color: ink, bold: true }],
      { x: 0.3, y: s.y, w: 4, h: s.h }, { align: "left", valign: "middle", shrink: true });
    dt.line({ x: 0.3, y: s.y + s.h - 0.05 }, { x: SLIDE_W - 0.4, y: s.y + s.h - 0.05 }, { color: accent, width: 1.25, arrow: false });
    dt.endGroup();
  }

  // task name + bar (or milestone diamond), grouped per task
  for (const b of lay.bars) {
    dt.beginGroup();
    dt.text([{ text: b.label, fontSize: 9, fontFace: fonts.body, color: ink, bold: false }],
      { x: 0.3, y: b.rowY, w: lay.labelColW, h: b.rowH }, { align: "left", valign: "middle", shrink: true });
    if (b.milestone) {
      const m = Math.min(b.rowH * 0.7, 0.24);
      dt.shape("diamond", { x: b.x - m / 2, y: b.rowY + b.rowH / 2 - m / 2, w: m, h: m }, { fill: b.color, line: { color: b.color, width: 0 } });
    } else {
      dt.shape("rounded_rect", { x: b.x, y: b.y, w: b.w, h: b.h }, { fill: b.color, line: { color: b.color, width: 0 }, rectRadius: Math.min(b.h / 2, 0.08) });
      // duration label just to the right of the bar
      dt.text([{ text: `${b.days}d`, fontSize: 8, fontFace: fonts.body, color: ink, bold: false }],
        { x: b.x + b.w + 0.06, y: b.rowY, w: 0.7, h: b.rowH }, { align: "left", valign: "middle", shrink: true });
    }
    dt.endGroup();
  }

  // status legend (only the statuses used)
  lay.legend.forEach((lg, i) => {
    const lx = 0.3 + i * 1.5;
    dt.beginGroup();
    dt.shape("rect", { x: lx, y: lay.legendY + 0.05, w: 0.18, h: 0.18 }, { fill: lg.color, line: { color: lg.color, width: 0 } });
    dt.text([{ text: lg.label, fontSize: 9, fontFace: fonts.body, color: ink, bold: false }],
      { x: lx + 0.26, y: lay.legendY, w: 1.2, h: 0.28 }, { align: "left", valign: "middle", shrink: true });
    dt.endGroup();
  });
}
