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
import type { ThemeConfig } from "./theme";
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
  ticks: { x: number; label: string }[];
  sections: { y: number; h: number; label: string }[];
  bars: { x: number; y: number; w: number; h: number; rowY: number; rowH: number; label: string; color: string; milestone: boolean }[];
  labelColW: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export function computeGanttLayout(spec: DiagramSpec, contentTop: number): GanttLayout {
  const g = spec.gantt;
  const tasks = g?.tasks ?? [];
  const labelColW = 2.0;
  const chartX0 = labelColW + 0.4;
  const chartX1 = SLIDE_W - 0.4;
  const chartW = chartX1 - chartX0;
  const maxDay = Math.max(1, ...tasks.map((t) => t.end));
  const dayToX = (d: number) => chartX0 + (d / maxDay) * chartW;

  const axisY = contentTop + 0.15;
  const ticks: GanttLayout["ticks"] = [];
  for (let i = 0; i <= 5; i++) {
    const day = Math.round((maxDay * i) / 5);
    ticks.push({ x: dayToX(day), label: offsetToMD(g?.startDate ?? "", day) });
  }

  // count rows (a section header row precedes each section's tasks)
  let nRows = 0;
  let lastSec: string | null = null;
  for (const t of tasks) { if (t.section !== lastSec) { nRows++; lastSec = t.section; } nRows++; }
  const rowsTop = axisY + 0.45;
  const rowH = Math.max(0.26, Math.min(0.42, (SLIDE_H - rowsTop - 0.3) / Math.max(nRows, 1)));

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
      label: t.name, color: statusColor(t.status), milestone: t.status.includes("milestone"),
    });
    row++;
  }

  return {
    axisY, ticks, sections, bars, labelColW,
    bbox: { minX: 0.1, minY: contentTop - 0.1, maxX: SLIDE_W - 0.2, maxY: rowsTop + nRows * rowH + 0.1 },
  };
}

export function paintGantt(dt: DrawTarget, lay: GanttLayout, theme: ThemeConfig): void {
  const fonts = theme.fonts;
  const accent = theme.palette.accent;
  const navy = theme.palette.navy;
  const grid = theme.diagram_style.edge_color;
  const ink = theme.palette.dark_text; // bare text on the (light) slide background

  // date axis: dashed gridlines + labels
  for (const tk of lay.ticks) {
    dt.line({ x: tk.x, y: lay.axisY + 0.24 }, { x: tk.x, y: lay.bbox.maxY - 0.05 }, { color: grid, width: 0.5, dash: true, arrow: false });
    dt.text([{ text: tk.label, fontSize: 8, fontFace: fonts.body, color: ink, bold: false }],
      { x: tk.x - 0.35, y: lay.axisY, w: 0.7, h: 0.22 }, { align: "center", valign: "middle", shrink: true });
  }

  // section header bands
  for (const s of lay.sections) {
    dt.beginGroup();
    dt.shape("rect", { x: 0.2, y: s.y + 0.02, w: SLIDE_W - 0.55, h: s.h - 0.04 }, { fill: navy, line: { color: accent, width: 0.5 } });
    dt.text([{ text: s.label, fontSize: 10, fontFace: fonts.heading, color: accent, bold: true }],
      { x: 0.32, y: s.y, w: 4, h: s.h }, { align: "left", valign: "middle", shrink: true });
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
    }
    dt.endGroup();
  }
}
