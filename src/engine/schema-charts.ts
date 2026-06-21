/**
 * schema-charts.ts — Data-visualisation sub-object schemas for DiagramSpec
 * (quadrant / gantt / xychart / radar / kpi). Each is a standalone z.object with
 * no node/edge dependency, so this file only needs zod — no import cycle with
 * schema.ts, which imports these for DiagramSpecSchema and re-exports them
 * (`export *`) so `from "./schema"` keeps resolving them. Split out for R1.
 * Pure logic (R2): no DOM / Tauri.
 */

import { z } from "zod/v4";

// Quadrant chart (2x2 matrix): axis labels, 4 quadrant labels, plotted points.
// q1=top-right, q2=top-left, q3=bottom-left, q4=bottom-right; point x/y in [0,1].
export const QuadrantSchema = z.object({
  xLow: z.string().default(""),
  xHigh: z.string().default(""),
  yLow: z.string().default(""),
  yHigh: z.string().default(""),
  q1: z.string().default(""),
  q2: z.string().default(""),
  q3: z.string().default(""),
  q4: z.string().default(""),
  points: z.array(z.object({ label: z.string(), x: z.number(), y: z.number() })).default([]),
});
export type Quadrant = z.infer<typeof QuadrantSchema>;

// Gantt chart: tasks with start/end as DAY OFFSETS from `startDate` (the parser
// resolves dates/durations/`after` deps into offsets); status ∈ done/active/crit/milestone.
export const GanttSchema = z.object({
  startDate: z.string().default(""),
  tasks: z.array(z.object({
    name: z.string(),
    section: z.string().default(""),
    start: z.number(),
    end: z.number(),
    status: z.string().default(""),
  })).default([]),
});
export type Gantt = z.infer<typeof GanttSchema>;

// XY chart (Mermaid xychart-beta): categorical x-axis + one or more numeric
// series, each drawn as bars or a line. ymax auto-computed when omitted.
export const XyChartSchema = z.object({
  xlabel: z.string().default(""),
  ylabel: z.string().default(""),
  ymin: z.number().default(0),
  ymax: z.number().optional(),
  categories: z.array(z.string()).default([]),
  series: z.array(z.object({
    kind: z.enum(["bar", "line"]),
    name: z.string().default(""),
    values: z.array(z.number()).default([]),
  })).default([]),
});
export type XyChart = z.infer<typeof XyChartSchema>;

// Radar / spider chart: N axes, each series gives one value per axis (0..max).
export const RadarSchema = z.object({
  axes: z.array(z.string()).default([]),
  max: z.number().default(5),
  series: z.array(z.object({
    name: z.string().default(""),
    values: z.array(z.number()).default([]),
  })).default([]),
});
export type Radar = z.infer<typeof RadarSchema>;

// KPI cards: big-number stat tiles. `value`/`delta` are strings (units allowed);
// `trend` ∈ up/down/"" tints the delta.
export const KpiSchema = z.object({
  cards: z.array(z.object({
    value: z.string(),
    label: z.string().default(""),
    delta: z.string().default(""),
    trend: z.string().default(""),
  })).default([]),
});
export type Kpi = z.infer<typeof KpiSchema>;
