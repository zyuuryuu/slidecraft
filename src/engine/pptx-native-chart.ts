/**
 * pptx-native-chart.ts — DiagramSpec（pie / xychart / radar）→ PptxGenJS `addChart` の入力（#554 段 1）。
 *
 * `charts: "native"` の書き出しで、グラフを図形の集まりでなく PowerPoint のネイティブ chart（埋め込み
 * ワークブック付き＝受け手が「データの編集」で数値や色を直せる）として出すための写像。既定の図形描画
 * （diagram-pie / diagram-xychart / diagram-radar の painter）は一切変えない。
 *
 * 同じ意味の二重計算（R8）を避けるため、データの取捨（pie は value > 0 のみ・系列名の既定・系列色）は
 * painter の layout と同じ規則・同じ配色定数を使い、tests/pptx-native-chart.test.ts の一致テストで
 * layout が描くデータと突き合わせる。プレビュー／HTML／get_slide_image は painter のまま＝近似。
 *
 * Pure logic (R2): no DOM / Tauri.
 */

import type PptxGenJS from "pptxgenjs";
import type { DiagramSpec } from "./schema";
import { type ThemeConfig, bareTextColor } from "./theme";
import { estTextWidth, fitTransform, type Box } from "./draw-target";
import { PIE_COLORS, computePieLayout } from "./diagram-pie";
import { SERIES_COLORS as XY_COLORS, computeXychartLayout } from "./diagram-xychart";
import { SERIES_COLORS as RADAR_COLORS, RINGS as RADAR_RINGS, computeRadarLayout } from "./diagram-radar";

/** 書き出しオプション: 既定 "shapes"＝現状の図形描画（byte-identical）／"native"＝ネイティブ chart。 */
export type ChartsMode = "shapes" | "native";

export const EMU_PER_INCH = 914400;

export type NativeChartKind = "pie" | "bar" | "line" | "radar";

export interface NativeChartSeries {
  name: string;
  labels: string[];
  values: number[];
}

export interface NativeChartPart {
  type: NativeChartKind;
  data: NativeChartSeries[];
  options: PptxGenJS.IChartOpts;
}

/**
 * `slide.addChart(type, data, options)` の入力（位置・サイズは含まない — nativeChartRect が与える）。
 * xychart で bar と line が混在する場合は `type: "combo"`: `parts` を PptxGenJS の複合 chart 配列として渡す
 * （`data` は painter と同じ系列順の全系列＝一致テスト用）。
 */
export interface NativeChart {
  type: NativeChartKind | "combo";
  data: NativeChartSeries[];
  options: PptxGenJS.IChartOpts;
  parts?: NativeChartPart[];
}

const hex = (c: string) => c.replace(/^#/, "");

/** 全種共通の文字書式（painter と同じ: 本文フォント・素地上の文字色）とタイトル・凡例。 */
function baseOptions(theme: ThemeConfig, title: string | undefined, legend: "r" | "b" | null): PptxGenJS.IChartOpts {
  const ink = hex(bareTextColor(theme));
  const font = theme.fonts.body;
  return {
    showTitle: !!title,
    ...(title ? { title, titleFontFace: theme.fonts.heading, titleFontSize: 13, titleColor: ink } : {}),
    showLegend: legend !== null,
    ...(legend ? { legendPos: legend, legendFontFace: font, legendFontSize: LEGEND_PT, legendColor: ink } : {}),
  };
}

/** 軸を持つ種（bar / line）の軸書式: 値軸の範囲・軸タイトル・目盛文字・破線グリッド（painter と同色）。 */
function axisOptions(spec: DiagramSpec, theme: ThemeConfig): PptxGenJS.IChartOpts {
  const x = spec.xychart!;
  const ink = hex(bareTextColor(theme));
  const font = theme.fonts.body;
  return {
    catAxisLabelColor: ink,
    catAxisLabelFontFace: font,
    catAxisLabelFontSize: 9,
    valAxisLabelColor: ink,
    valAxisLabelFontFace: font,
    valAxisLabelFontSize: 8,
    valAxisMinVal: x.ymin,
    ...(x.ymax !== undefined ? { valAxisMaxVal: x.ymax } : {}),
    showCatAxisTitle: !!x.xlabel,
    ...(x.xlabel ? { catAxisTitle: x.xlabel, catAxisTitleColor: ink, catAxisTitleFontFace: font, catAxisTitleFontSize: 9 } : {}),
    showValAxisTitle: !!x.ylabel,
    ...(x.ylabel ? { valAxisTitle: x.ylabel, valAxisTitleColor: ink, valAxisTitleFontFace: font, valAxisTitleFontSize: 9 } : {}),
    valGridLine: { color: hex(theme.diagram_style.edge_color), style: "dash", size: 0.5 },
    catGridLine: { style: "none" },
  };
}

const BAR_OPTS: PptxGenJS.IChartOpts = { barDir: "col", barGrouping: "clustered", barGapWidthPct: 50 };
const LINE_OPTS: PptxGenJS.IChartOpts = { lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 7 };

function pieChart(spec: DiagramSpec, theme: ThemeConfig): NativeChart | null {
  // painter と同じ規則（value > 0 のみ）で slice を取る — 同じ配色を index で巡回
  const slices = spec.nodes.filter((n) => (n.value ?? 0) > 0);
  if (slices.length === 0) return null;
  return {
    type: "pie",
    data: [{ name: spec.title ?? "", labels: slices.map((n) => n.label), values: slices.map((n) => n.value!) }],
    options: {
      // painter の pie は自前のタイトルを描かない（凡例＋% ラベル）— それに合わせる
      ...baseOptions(theme, undefined, "r"),
      chartColors: slices.map((_, i) => hex(PIE_COLORS[i % PIE_COLORS.length])),
      dataBorder: { pt: 1.25, color: hex(theme.diagram_style.slide_bg ?? "#0A0E27") },
      // the native legend shows category names only (the painter's legend reads "製品A  42"), so the value
      // rides on the slice label with the % instead (#566 (a)); the workbook's category names stay untouched
      showPercent: true,
      showValue: true,
      dataLabelColor: "FFFFFF",
      dataLabelFontSize: 10,
      dataLabelFontBold: true,
      dataLabelFontFace: theme.fonts.body,
      dataLabelPosition: "ctr",
      firstSliceAng: 0, // 12 時から時計回り（painter と同じ）
    },
  };
}

function xyChart(spec: DiagramSpec, theme: ThemeConfig): NativeChart | null {
  const x = spec.xychart;
  if (!x || x.series.length === 0 || x.categories.length === 0) return null;
  const labels = x.categories;
  const all = x.series.map((s, gi) => ({
    kind: s.kind,
    color: hex(XY_COLORS[gi % XY_COLORS.length]),
    // painter の凡例と同じ既定名
    data: { name: s.name || `${s.kind} ${gi + 1}`, labels, values: s.values.slice(0, labels.length) },
  }));
  const options: PptxGenJS.IChartOpts = {
    ...baseOptions(theme, spec.title, all.length > 1 ? "b" : null),
    ...axisOptions(spec, theme),
  };
  const bars = all.filter((s) => s.kind === "bar");
  const lines = all.filter((s) => s.kind === "line");
  const data = all.map((s) => s.data);
  if (lines.length === 0) return { type: "bar", data, options: { ...options, ...BAR_OPTS, chartColors: bars.map((s) => s.color) } };
  if (bars.length === 0) return { type: "line", data, options: { ...options, ...LINE_OPTS, chartColors: lines.map((s) => s.color) } };
  return {
    type: "combo",
    data,
    options,
    // One line part PER line series, its colour list filled with that one colour: in a multi-type chart
    // PptxGenJS strokes a line by its index WITHIN the part but fills its marker by its index across ALL
    // parts (and picks Math.random() when that overruns the list) — a uniform list makes both the same colour
    // and keeps the chart XML deterministic.
    parts: [
      { type: "bar", data: bars.map((s) => s.data), options: { ...BAR_OPTS, chartColors: bars.map((s) => s.color) } },
      ...lines.map((s): NativeChartPart => ({ type: "line", data: [s.data], options: { ...LINE_OPTS, chartColors: all.map(() => s.color) } })),
    ],
  };
}

function radarChart(spec: DiagramSpec, theme: ThemeConfig): NativeChart | null {
  const r = spec.radar;
  if (!r || r.series.length === 0 || r.axes.length === 0) return null;
  const max = r.max > 0 ? r.max : 5; // painter と同じ既定
  const ink = hex(bareTextColor(theme));
  const values = r.series.map((s) => r.axes.map((_, k) => s.values[k] ?? 0));
  const top = Math.max(max, ...values.flat());
  // painter は max 超えを外周にクランプして描くが、ネイティブは実データを持つので、軸の上限を超えた値まで
  // 広げる（固定 max のままだと線が軸の外へはみ出して描かれる — LibreOffice 描画で実測）。
  return {
    type: "radar",
    // 値は丸めない（受け手が編集する実データ）。欠けた軸は 0（painter 同様）
    data: r.series.map((s, si) => ({ name: s.name || `系列 ${si + 1}`, labels: r.axes, values: values[si] })),
    options: {
      ...baseOptions(theme, spec.title, r.series.length > 1 ? "b" : null),
      radarStyle: "marker",
      chartColors: r.series.map((_, si) => hex(RADAR_COLORS[si % RADAR_COLORS.length])),
      lineSize: 2,
      lineDataSymbol: "circle",
      lineDataSymbolSize: 7,
      valAxisMinVal: 0,
      valAxisMaxVal: top,
      // the painter's RINGS rings, the outer one on the axis top (unset, renderers picked a unit of 5 and drew a
      // single ring — #566); no value labels on the rings, like the painter
      valAxisMajorUnit: top / RADAR_RINGS,
      valAxisLabelPos: "none",
      catAxisLabelColor: ink,
      catAxisLabelFontFace: theme.fonts.body,
      catAxisLabelFontSize: 9,
      valGridLine: { color: hex(theme.diagram_style.edge_color), size: 0.5 },
    },
  };
}

/** 段 1 の対象（pie / xychart / radar）なら addChart の入力、対象外・データ無しは null（＝図形描画へフォールバック）。 */
export function chartSpecToNativeChart(spec: DiagramSpec, theme: ThemeConfig): NativeChart | null {
  if (spec.type === "pie") return pieChart(spec, theme);
  if (spec.type === "xychart") return xyChart(spec, theme);
  if (spec.type === "radar") return radarChart(spec, theme);
  return null;
}

/** Legend font size (pt) — the same for the native legend (baseOptions) and its width estimate below. */
const LEGEND_PT = 10;
/** pie: what a native legend row needs right of the painter's legendX — swatch 0.18 + gap 0.28 (as the
 *  painter's legend) + the longest category name; plus a margin for the chart's own inner padding. */
const PIE_LEGEND_INSET = 0.46;
const PIE_FRAME_MARGIN = 0.3;

/** 埋め込み図（omitTitle＝painter の contentTop 0.8）の配置矩形（inch）: layout の bbox を、region があれば
 *  painter と同じ fitTransform で region に収めたもの。図形版の図が占める矩形と同じ。対象外は null。
 *  pie だけは右端を「凡例の右端の見積もり」で切る（#566）: 図形版の bbox は凡例の文字のため SLIDE_W - 0.4 まで
 *  取るが、ネイティブ chart は枠いっぱいに広がり凡例を枠の右端に置くので、そのままでは円と凡例が離れる。
 *  縮尺・左上は図形版と同じ（円は図形版の円の位置に描かれる）。 */
export function nativeChartRect(spec: DiagramSpec, region?: Box): Box | null {
  const contentTop = 0.8;
  const pie = spec.type === "pie" ? computePieLayout(spec, contentTop) : null;
  const bbox =
    pie ? pie.bbox
    : spec.type === "xychart" ? computeXychartLayout(spec, contentTop).bbox
    : spec.type === "radar" ? computeRadarLayout(spec, contentTop).bbox
    : null;
  if (!bbox) return null;
  const t = region ? fitTransform(bbox, region) : { scale: 1, offsetX: 0, offsetY: 0 };
  const maxX = pie ? Math.min(bbox.maxX, pieLegendRight(pie) + PIE_FRAME_MARGIN) : bbox.maxX;
  return {
    x: bbox.minX * t.scale + t.offsetX,
    y: bbox.minY * t.scale + t.offsetY,
    w: (maxX - bbox.minX) * t.scale,
    h: (bbox.maxY - bbox.minY) * t.scale,
  };
}

function pieLegendRight(lay: ReturnType<typeof computePieLayout>): number {
  const longest = Math.max(0, ...lay.slices.map((s) => estTextWidth(s.label, LEGEND_PT) / 72));
  return lay.legendX + PIE_LEGEND_INSET + longest;
}
