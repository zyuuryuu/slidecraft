/**
 * chart-edit-ops.ts — #106 P3 / ADR-0019: DATA ops. The model rewrites only the cell / value it
 * changes — a table cell (`setCell`), a chart series value (`setSeriesValue`), a gantt task
 * (`setTask`), a KPI card (`setCard`) — and the engine writes it into the slide's EXISTING
 * representation: `slide.table.rows` (the same grid parseMarkdownTable / tableToMarkdown round-trip)
 * and the figure's raw YAML through applyToFigure (the same re-dump the figure ops use). No second
 * representation of the data exists here (R8: tests/chart-edit-ops.test.ts pins ops ≡ editing the
 * slide's Markdown and re-parsing it).
 *
 * Contract (same as field-edit-ops / P2): the reply is a whole-string bare JSON array; a malformed
 * array falls back to the full-text path with a notice; an op whose target is missing is skipped and
 * announced (never silent); when nothing applied the ORIGINAL slide object is returned (no spurious
 * diff). The vocabulary is disjoint from setField / figure / design ops, so a reply matches at most
 * one parser. Pure logic (R2): no DOM / Tauri.
 */
import { z } from "zod";
import type { SlideIR } from "./slide-schema";
import { bareArray } from "./field-edit-ops";
import { applyToFigure, readFigureRaw, type RawDiagram } from "./design-intent";

const Index = z.number().int().nonnegative();

const SetCellOp = z.object({ op: z.literal("setCell"), row: Index, col: Index, text: z.string() });
// series: 0-based position in the chart's series list, or its exact name.
const SetSeriesValueOp = z.object({ op: z.literal("setSeriesValue"), series: z.union([Index, z.string()]), index: Index, value: z.number() });
// gantt tasks carry no id in the schema — a task is named by its (unique) name; newName renames it.
// start/end are DAY OFFSETS from gantt.startDate, as stored in the figure YAML.
const SetTaskOp = z.object({
  op: z.literal("setTask"), name: z.string().min(1), newName: z.string().min(1).optional(),
  start: z.number().optional(), end: z.number().optional(), status: z.string().optional(), section: z.string().optional(),
});
// KPI card by 0-based position; the fields are the schema's card fields (schema-charts.ts KpiSchema).
const SetCardOp = z.object({
  op: z.literal("setCard"), index: Index,
  value: z.string().optional(), label: z.string().optional(), delta: z.string().optional(), trend: z.string().optional(),
});

export const DataEditOpsSchema = z.array(z.discriminatedUnion("op", [SetCellOp, SetSeriesValueOp, SetTaskOp, SetCardOp])).min(1);
export type DataEditOps = z.infer<typeof DataEditOpsSchema>;
export type DataEditOp = DataEditOps[number];
type CellOp = z.infer<typeof SetCellOp>;
type FigureOp = Exclude<DataEditOp, CellOp>;
const DATA_OPS = new Set(["setCell", "setSeriesValue", "setTask", "setCard"]);

/** A DATA op that didn't take effect — surfaced never-silently (mirrors SkippedFieldOp). */
export interface SkippedDataOp {
  op: DataEditOp["op"];
  reason: "no-table" | "out-of-range" | "multiline-cell" | "no-chart" | "unparseable-figure" | "unknown-series" | "unknown-task" | "ambiguous-task" | "invalid-range";
  message: string; // human, Japanese — ready to show as a notice
}

/** Detect a DATA ops array in raw model output. null → not a (valid) DATA ops reply. */
export function parseDataEditOps(raw: string): DataEditOps | null {
  const arr = bareArray(raw);
  if (!arr) return null;
  const d = DataEditOpsSchema.safeParse(arr);
  return d.success ? d.data : null;
}

/** A bare array naming a DATA op yet failing the schema (missing field, negative index, mixed with
 *  another vocabulary …): not applied as ops — the caller falls back to full text and shows this. */
export function malformedDataOpsNotice(raw: string): string | null {
  const arr = bareArray(raw);
  if (!arr || !arr.some((o) => typeof o === "object" && o !== null && DATA_OPS.has(String((o as { op?: unknown }).op)))) return null;
  if (DataEditOpsSchema.safeParse(arr).success) return null;
  return "[opsフォールバック] 表・グラフの部分編集（setCell などの DATA ops）の形式が不正なため、スライド全文の編集として処理しました。各 op の必須項目（番号は 0 以上の整数）を満たし、1 回の返答に他の種類の op を混ぜられません。";
}

// ── Table: setCell writes slide.table.rows[row][col] (row 0 = the header row when table.header) ──

function applyCells(slide: SlideIR, ops: CellOp[], skipped: SkippedDataOp[]): SlideIR {
  const t = slide.table;
  if (!t) {
    for (const o of ops) skipped.push({ op: o.op, reason: "no-table", message: "setCell: このスライドには表がないため適用しませんでした。" });
    return slide;
  }
  const rows = t.rows.slice();
  const ncol = rows[0]?.length ?? 0;
  let dirty = false;
  for (const o of ops) {
    if (o.row >= rows.length || o.col >= ncol) {
      skipped.push({ op: o.op, reason: "out-of-range", message: `setCell: (row ${o.row}, col ${o.col}) は表の範囲外のため適用しませんでした（表は ${rows.length} 行 × ${ncol} 列・0 始まり）` });
      continue;
    }
    if (/[\r\n]/.test(o.text)) {
      skipped.push({ op: o.op, reason: "multiline-cell", message: `setCell: (row ${o.row}, col ${o.col}) の文面に改行があり、表のセルに入れられないため適用しませんでした。` });
      continue;
    }
    if (rows[o.row][o.col] === o.text) continue;
    rows[o.row] = rows[o.row].slice();
    rows[o.row][o.col] = o.text;
    dirty = true;
  }
  return dirty ? { ...slide, table: { ...t, rows } } : slide;
}

// ── Figure data: written into the figure's raw YAML via applyToFigure (P1's re-dump; a Mermaid figure
// graduates to the canonical diagram, exactly as a figure op does) ──

type Series = { name?: unknown; values?: unknown[] };
const listOf = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const quoted = (names: string[]): string => names.map((n) => `「${n}」`).join("・") || "なし";

/** The chart object a setSeriesValue edits: xychart or radar (by the figure's type). */
function seriesChart(raw: RawDiagram): { series: Series[]; slots: string } | null {
  const c = (raw.type === "xychart" ? raw.xychart : raw.type === "radar" ? raw.radar : null) as { series?: unknown } | null | undefined;
  return c ? { series: listOf<Series>(c.series), slots: raw.type === "xychart" ? "カテゴリ" : "軸" } : null;
}

const NO_CHART: Record<FigureOp["op"], string> = {
  setSeriesValue: "setSeriesValue: このスライドの図は折れ線・棒（xychart）／レーダー（radar）ではないため適用しませんでした。",
  setTask: "setTask: このスライドの図はガントチャート（gantt）ではないため適用しませんでした。",
  setCard: "setCard: このスライドの図は KPI カード（kpi）ではないため適用しませんでした。",
};

const kpiCards = (raw: RawDiagram): Array<Record<string, unknown>> | null =>
  raw.type === "kpi" && raw.kpi ? listOf<Record<string, unknown>>((raw.kpi as { cards?: unknown }).cards) : null;

type Task = { name?: unknown; start?: unknown; end?: unknown; [k: string]: unknown };
const ganttTasks = (raw: RawDiagram): Task[] | null =>
  raw.type === "gantt" && raw.gantt ? listOf<Task>((raw.gantt as { tasks?: unknown }).tasks) : null;

/** Write the given fields onto `target`; true when any value actually changed. */
function assign(target: Record<string, unknown>, fields: Record<string, unknown>): boolean {
  let changed = false;
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || target[k] === v) continue;
    target[k] = v;
    changed = true;
  }
  return changed;
}

/** Apply one figure op to the raw YAML object. Returns true when it changed a value. */
function applyFigureOp(raw: RawDiagram, o: FigureOp, skip: (reason: SkippedDataOp["reason"], message: string) => void): boolean {
  switch (o.op) {
    case "setSeriesValue": {
      const chart = seriesChart(raw);
      if (!chart) { skip("no-chart", NO_CHART[o.op]); return false; }
      const names = chart.series.map((x, i) => (x.name ? String(x.name) : `#${i}`));
      const ser = typeof o.series === "number" ? chart.series[o.series] : chart.series.find((x) => String(x.name ?? "") === o.series);
      if (!ser) { skip("unknown-series", `setSeriesValue: 系列 ${JSON.stringify(o.series)} が見つからず適用しませんでした（系列: ${quoted(names)}）`); return false; }
      const values = listOf<unknown>(ser.values);
      if (o.index >= values.length) { skip("out-of-range", `setSeriesValue: index ${o.index} は範囲外のため適用しませんでした（値は ${values.length} 個・0 始まり）`); return false; }
      if (values[o.index] === o.value) return false;
      values[o.index] = o.value;
      ser.values = values;
      return true;
    }
    case "setTask": {
      const tasks = ganttTasks(raw);
      if (!tasks) { skip("no-chart", NO_CHART[o.op]); return false; }
      const hits = tasks.filter((t) => String(t.name ?? "") === o.name);
      if (hits.length === 0) { skip("unknown-task", `setTask: タスク「${o.name}」が見つからず適用しませんでした（タスク: ${quoted(tasks.map((t) => String(t.name ?? "")))}）`); return false; }
      if (hits.length > 1) { skip("ambiguous-task", `setTask: タスク名「${o.name}」が ${hits.length} 件あり特定できないため適用しませんでした。`); return false; }
      const t = hits[0];
      const start = o.start ?? Number(t.start);
      const end = o.end ?? Number(t.end);
      if (end < start) { skip("invalid-range", `setTask: タスク「${o.name}」の終了（${end}）が開始（${start}）より前になるため適用しませんでした。`); return false; }
      return assign(t, { name: o.newName, start: o.start, end: o.end, status: o.status, section: o.section });
    }
    case "setCard": {
      const cards = kpiCards(raw);
      if (!cards) { skip("no-chart", NO_CHART[o.op]); return false; }
      const card = cards[o.index];
      if (!card) { skip("out-of-range", `setCard: index ${o.index} のカードは無いため適用しませんでした（カードは ${cards.length} 枚・0 始まり）`); return false; }
      return assign(card, { value: o.value, label: o.label, delta: o.delta, trend: o.trend });
    }
  }
}

function applyFigureOps(slide: SlideIR, ops: FigureOp[], skipped: SkippedDataOp[]): SlideIR {
  const all = (reason: SkippedDataOp["reason"], message: (o: FigureOp) => string): SlideIR => {
    for (const o of ops) skipped.push({ op: o.op, reason, message: message(o) });
    return slide;
  };
  if (!slide.diagram && !slide.mermaidBlock) return all("no-chart", (o) => NO_CHART[o.op]);
  if (readFigureRaw(slide) === null) return all("unparseable-figure", (o) => `${o.op}: 図の定義を解析できないため適用しませんでした（図の記述に不正がある可能性）。`);
  let dirty = false;
  const out = applyToFigure(slide, (_spec, raw) => {
    for (const o of ops) if (applyFigureOp(raw, o, (reason, message) => skipped.push({ op: o.op, reason, message }))) dirty = true;
  });
  return dirty ? out : slide;
}

/**
 * Merge DATA ops in order. Each target kind is applied once, in the order the ops name them; within a
 * kind the ops apply in sequence (a later op sees an earlier one's write). Untouched content stays the
 * same objects; an all-skip / no-change batch returns the ORIGINAL slide.
 */
export function applyDataEditOps(slide: SlideIR, ops: DataEditOps): { slide: SlideIR; skipped: SkippedDataOp[] } {
  const skipped: SkippedDataOp[] = [];
  const cells = ops.filter((o): o is CellOp => o.op === "setCell");
  const figure = ops.filter((o): o is FigureOp => o.op !== "setCell");
  let out = slide;
  if (cells.length > 0) out = applyCells(out, cells, skipped);
  if (figure.length > 0) out = applyFigureOps(out, figure, skipped);
  return { slide: out, skipped };
}

/** The GUI's DATA branch, beside routeFieldEdit (same result shape so the caller can `??` them). */
export type DataEditRoute =
  | { kind: "ops"; slide: SlideIR; notices: string[] }
  | { kind: "fallback"; notice: string };
export function routeDataEdit(slide: SlideIR, raw: string): DataEditRoute | null {
  const ops = parseDataEditOps(raw);
  if (ops) {
    const r = applyDataEditOps(slide, ops);
    return { kind: "ops", slide: r.slide, notices: r.skipped.map((s) => s.message) };
  }
  const notice = malformedDataOpsNotice(raw);
  return notice ? { kind: "fallback", notice } : null;
}

/**
 * The table / chart listing handed to the model next to the slide Markdown, so a DATA op can name a
 * real row / series / task / card. Empty when the slide carries none (the request is then unchanged).
 */
export function describeEditableData(slide: SlideIR): string {
  const str = (v: unknown): string => JSON.stringify(String(v ?? ""));
  const out: string[] = [];
  const t = slide.table;
  if (t && t.rows.length > 0) {
    out.push(`Table (setCell row/col, 0-based${t.header ? "; row 0 = header" : ""}):`);
    t.rows.forEach((r, i) => out.push(`- row ${i}: ${JSON.stringify(r)}`));
  }
  const raw = slide.diagram || slide.mermaidBlock ? readFigureRaw(slide) : null;
  if (!raw) return out.join("\n");
  const chart = seriesChart(raw);
  if (chart) {
    const c = (raw.type === "xychart" ? raw.xychart : raw.radar) as { categories?: unknown; axes?: unknown };
    out.push("Chart series (setSeriesValue series/index, 0-based):");
    out.push(raw.type === "xychart" ? `- categories: ${JSON.stringify(listOf(c.categories))}` : `- axes: ${JSON.stringify(listOf(c.axes))}`);
    chart.series.forEach((x, i) => out.push(`- series ${i} ${str(x.name)}: ${JSON.stringify(listOf(x.values))}`));
  }
  const tasks = ganttTasks(raw);
  if (tasks) {
    out.push(`Gantt tasks (setTask by name; start/end = day offsets from ${str((raw.gantt as { startDate?: unknown }).startDate)}):`);
    for (const k of tasks) out.push(`- ${str(k.name)}: start ${String(k.start)}, end ${String(k.end)}, status ${str(k.status)}, section ${str(k.section)}`);
  }
  const cards = kpiCards(raw);
  if (cards) {
    out.push("KPI cards (setCard index, 0-based):");
    cards.forEach((c, i) => out.push(`- card ${i}: value ${str(c.value)}, label ${str(c.label)}, delta ${str(c.delta)}, trend ${str(c.trend)}`));
  }
  return out.join("\n");
}
