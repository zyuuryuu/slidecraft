/**
 * pptx-native-chart.test.ts — #554 段 1: DiagramSpec（pie / xychart / radar）→ PptxGenJS `addChart` の
 * 入力（type / data / options）へ写す純関数 `chartSpecToNativeChart` と、その配置矩形 `nativeChartRect`。
 *
 * - スナップショット: 3 種の主要フィールドを明示値で固定（type・data・色・凡例・軸）。
 * - R8 一致テスト（同じ意味を 2 経路で計算するなら一致を検査する・CLAUDE.md R8）: マッパーの
 *   labels / 系列名 / values / 系列色が、painter の layout（computePieLayout / computeXychartLayout /
 *   computeRadarLayout）が描くデータと一致する。矩形は painter が実際に描いた範囲を包む。
 */
import { describe, it, expect } from "vitest";
import { chartSpecToNativeChart, nativeChartRect, type NativeChart } from "../src/engine/pptx-native-chart";
import { computePieLayout } from "../src/engine/diagram-pie";
import { computeXychartLayout } from "../src/engine/diagram-xychart";
import { computeRadarLayout } from "../src/engine/diagram-radar";
import { SLIDE_W } from "../src/engine/layout-engine";
import { paintDiagram } from "../src/engine/diagram-painter";
import { estTextWidth, fitTransform, type DrawTarget, type Box } from "../src/engine/draw-target";
import { midnightExecutive, bareTextColor } from "../src/engine/theme";
import { parseDiagramJson } from "../src/engine/schema";
import { PIE, XY, XY_BAR_ONLY, XY_LINE_ONLY, RADAR, FLOW } from "./native-chart-fixtures";

const theme = midnightExecutive();
const INK = bareTextColor(theme).replace(/^#/, "");
const EMBED_TOP = 0.8; // the painter's contentTop for an embedded (omitTitle) figure

function must(spec: Parameters<typeof chartSpecToNativeChart>[0]): NativeChart {
  const nc = chartSpecToNativeChart(spec, theme);
  if (!nc) throw new Error("expected a native chart");
  return nc;
}

describe("chartSpecToNativeChart — snapshot of the 3 chart kinds", () => {
  it("pie → `pie`: positive slices only, slice colours, value + % labels, legend right, no title", () => {
    const nc = must(PIE);
    expect(nc.type).toBe("pie");
    expect(nc.data).toEqual([{ name: "市場シェア", labels: ["製品A", "製品B", "その他"], values: [42, 30, 28] }]);
    expect(nc.options).toMatchObject({
      chartColors: ["3B82F6", "06B6D4", "10B981"],
      // #566 (a): the native legend shows names only, so the value goes on the slice label with the %
      showPercent: true,
      showValue: true,
      showLegend: true,
      legendPos: "r",
      legendColor: INK,
      legendFontFace: theme.fonts.body,
      showTitle: false,
      firstSliceAng: 0,
    });
    expect(nc.parts).toBeUndefined();
  });

  it("xychart bar+line → combo: bar part (col, clustered) + line part, colours by series index, axes titled", () => {
    const nc = must(XY);
    expect(nc.type).toBe("combo");
    expect(nc.data).toEqual([
      { name: "売上", labels: ["Q1", "Q2", "Q3", "Q4"], values: [120, 150, 170, 210] },
      { name: "原価", labels: ["Q1", "Q2", "Q3", "Q4"], values: [80, 90, 100, 120] },
      { name: "利益率", labels: ["Q1", "Q2", "Q3", "Q4"], values: [40, 60, 70, 90] },
    ]);
    expect(nc.parts?.map((p) => [p.type, p.data.map((d) => d.name), p.options.chartColors])).toEqual([
      ["bar", ["売上", "原価"], ["3B82F6", "06B6D4"]],
      // a line part per line series, its colour list uniform (see the mapper: PptxGenJS marker-colour quirk)
      ["line", ["利益率"], ["F59E0B", "F59E0B", "F59E0B"]],
    ]);
    expect(nc.parts?.[0].options).toMatchObject({ barDir: "col", barGrouping: "clustered" });
    expect(nc.options).toMatchObject({
      showTitle: true,
      title: "売上推移",
      showLegend: true,
      legendPos: "b",
      showCatAxisTitle: true,
      catAxisTitle: "四半期",
      showValAxisTitle: true,
      valAxisTitle: "百万円",
      valAxisMinVal: 0,
    });
    expect(nc.options.valAxisMaxVal).toBeUndefined(); // ymax omitted → PowerPoint auto-scales
  });

  it("xychart bar-only → `bar` (col); ymax pinned; single series → no legend; painter's fallback series name", () => {
    const nc = must(XY_BAR_ONLY);
    expect(nc.type).toBe("bar");
    expect(nc.data).toEqual([{ name: "bar 1", labels: ["A", "B", "C"], values: [10, 25, 40] }]);
    expect(nc.options).toMatchObject({
      barDir: "col",
      chartColors: ["3B82F6"],
      showLegend: false,
      showTitle: false,
      showCatAxisTitle: false,
      showValAxisTitle: true,
      valAxisTitle: "件数",
      valAxisMinVal: 0,
      valAxisMaxVal: 50,
    });
  });

  it("xychart line-only → `line` with circle markers", () => {
    const nc = must(XY_LINE_ONLY);
    expect(nc.type).toBe("line");
    expect(nc.data).toEqual([{ name: "来場", labels: ["1月", "2月", "3月"], values: [3, 5, 4] }]);
    expect(nc.options).toMatchObject({ chartColors: ["3B82F6"], lineDataSymbol: "circle", showLegend: false });
  });

  it("radar → `radar`: axes as labels, raw values (no clamp), 0..max scale widened to an over-max value, legend bottom", () => {
    const nc = must(RADAR);
    expect(nc.type).toBe("radar");
    const axes = ["設計", "実装", "テスト", "運用", "文書"];
    expect(nc.data).toEqual([
      { name: "現状", labels: axes, values: [3, 4, 2, 3, 2] },
      { name: "目標", labels: axes, values: [4, 5, 4, 4, 6] },
    ]);
    expect(nc.options).toMatchObject({
      radarStyle: "marker",
      chartColors: ["3B82F6", "F59E0B"],
      valAxisMinVal: 0,
      valAxisMaxVal: 6, // max 5, but 目標/文書 = 6 — a fixed 5 would draw the line outside the chart
      valAxisMajorUnit: 1.5, // #566: 4 rings (6 / 4) like the painter — unset, renderers drew one ring at 5
      valAxisLabelPos: "none", // the painter draws no value labels on the rings
      showLegend: true,
      legendPos: "b",
      showTitle: true,
      title: "スキル評価",
    });
  });

  it("radar within max keeps the spec's max as the axis top", () => {
    const within = parseDiagramJson(JSON.stringify({ type: "radar", direction: "TB", nodes: [], edges: [], radar: { axes: ["a", "b", "c"], max: 10, series: [{ values: [1, 2] }] } }));
    const nc = must(within);
    expect(nc.options.valAxisMaxVal).toBe(10);
    expect(nc.options.valAxisMajorUnit).toBe(2.5);
    expect(nc.data).toEqual([{ name: "系列 1", labels: ["a", "b", "c"], values: [1, 2, 0] }]); // missing axis → 0, like the painter
  });

  it("returns null (→ shapes fallback) for non-chart types and for charts with no data", () => {
    expect(chartSpecToNativeChart(FLOW, theme)).toBeNull();
    const quadrant = parseDiagramJson(JSON.stringify({ type: "quadrant", direction: "TB", nodes: [], edges: [], quadrant: { points: [{ label: "a", x: 0.2, y: 0.3 }] } }));
    expect(chartSpecToNativeChart(quadrant, theme)).toBeNull();
    const emptyPie = parseDiagramJson(JSON.stringify({ type: "pie", direction: "TB", nodes: [{ id: "a", label: "a", value: 0 }], edges: [] }));
    expect(chartSpecToNativeChart(emptyPie, theme)).toBeNull();
    const emptyXy = parseDiagramJson(JSON.stringify({ type: "xychart", direction: "TB", nodes: [], edges: [], xychart: { categories: ["a"], series: [] } }));
    expect(chartSpecToNativeChart(emptyXy, theme)).toBeNull();
    const emptyRadar = parseDiagramJson(JSON.stringify({ type: "radar", direction: "TB", nodes: [], edges: [], radar: { axes: ["a", "b", "c"], series: [] } }));
    expect(chartSpecToNativeChart(emptyRadar, theme)).toBeNull();
  });
});

// ── R8: the mapper's data == the data the painter's layout draws (same spec through both paths) ──
describe("R8 agreement — mapper data == painter layout data", () => {
  it("pie: labels / values / colours == computePieLayout slices", () => {
    const lay = computePieLayout(PIE, EMBED_TOP);
    const nc = must(PIE);
    expect(nc.data[0].labels).toEqual(lay.slices.map((s) => s.label));
    expect(nc.data[0].values).toEqual(lay.slices.map((s) => s.value));
    expect(nc.options.chartColors).toEqual(lay.slices.map((s) => s.color.replace(/^#/, "")));
  });

  for (const [name, spec] of [["bar+line", XY], ["bar only", XY_BAR_ONLY], ["line only", XY_LINE_ONLY]] as const) {
    it(`xychart (${name}): labels == x labels; each series' values ∝ its drawn bar heights / line points; colours match`, () => {
      const lay = computeXychartLayout(spec, EMBED_TOP);
      const nc = must(spec);
      expect(nc.data.every((d) => JSON.stringify(d.labels) === JSON.stringify(lay.xlabels.map((x) => x.label)))).toBe(true);
      const series = spec.xychart!.series;
      const colorOf = (gi: number) => {
        const part = nc.parts?.find((p) => p.data.some((d) => d === nc.data[gi])) ?? nc;
        const idx = part.data.indexOf(nc.data[gi]);
        return (part.options.chartColors as string[])[idx];
      };
      // drawn magnitudes in painter order: bars are grouped per bar-series, polylines per line-series
      const barSeries = series.map((s, gi) => ({ s, gi })).filter((o) => o.s.kind === "bar");
      const lineSeries = series.map((s, gi) => ({ s, gi })).filter((o) => o.s.kind === "line");
      const ratios: number[] = [];
      let b = 0;
      for (const o of barSeries) {
        for (let i = 0; i < o.s.values.length; i++, b++) {
          const bar = lay.bars[b];
          expect(bar.color.replace(/^#/, "")).toBe(colorOf(o.gi));
          ratios.push((lay.yBot - bar.y) / nc.data[o.gi].values[i]);
        }
      }
      lineSeries.forEach((o, li) => {
        const pl = lay.polylines[li];
        expect(pl.color.replace(/^#/, "")).toBe(colorOf(o.gi));
        pl.pts.forEach((p, i) => ratios.push((lay.yBot - p.y) / nc.data[o.gi].values[i]));
      });
      expect(nc.data.map((d) => d.name)).toEqual(series.map((s, gi) => s.name || `${s.kind} ${gi + 1}`));
      // ymin = 0 in these fixtures → drawn height = value × one constant scale for EVERY bar and point
      for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 9);
    });
  }

  it("radar: axis labels / series names / colours match; clamp(value)/max == drawn radius / R", () => {
    const lay = computeRadarLayout(RADAR, EMBED_TOP);
    const nc = must(RADAR);
    const max = RADAR.radar!.max;
    expect(nc.data[0].labels).toEqual(lay.axisLabels.map((a) => a.label));
    expect(nc.data.map((d) => d.name)).toEqual(lay.series.map((s) => s.name));
    expect(nc.options.chartColors).toEqual(lay.series.map((s) => s.color.replace(/^#/, "")));
    const c = lay.spokes[0].from;
    const R = Math.hypot(lay.spokes[0].to.x - c.x, lay.spokes[0].to.y - c.y);
    lay.series.forEach((s, si) => {
      s.pts.forEach((p, k) => {
        const drawn = Math.hypot(p.x - c.x, p.y - c.y) / R;
        expect(drawn).toBeCloseTo(Math.min(max, Math.max(0, nc.data[si].values[k])) / max, 9);
      });
    });
  });

  it("radar (#566): the native axis has as many rings as the painter draws (majorUnit == axis top / rings)", () => {
    const lay = computeRadarLayout(RADAR, EMBED_TOP);
    const nc = must(RADAR);
    expect(nc.options.valAxisMajorUnit).toBe((nc.options.valAxisMaxVal as number) / lay.rings.length);
  });
});

// ── the native chart sits where the shapes figure sits ──
class ExtentRecorder implements DrawTarget {
  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
  private add(x0: number, y0: number, x1: number, y1: number) {
    this.minX = Math.min(this.minX, x0); this.minY = Math.min(this.minY, y0);
    this.maxX = Math.max(this.maxX, x1); this.maxY = Math.max(this.maxY, y1);
  }
  background(): void {}
  shape(_k: unknown, b: Box): void { this.add(b.x, b.y, b.x + b.w, b.y + b.h); }
  line(f: { x: number; y: number }, t: { x: number; y: number }): void { this.add(Math.min(f.x, t.x), Math.min(f.y, t.y), Math.max(f.x, t.x), Math.max(f.y, t.y)); }
  text(_l: unknown, b: Box): void { this.add(b.x, b.y, b.x + b.w, b.y + b.h); }
  beginGroup(): void {}
  endGroup(): void {}
  wedge(cx: number, cy: number, r: number): void { this.add(cx - r, cy - r, cx + r, cy + r); }
}

describe("nativeChartRect — the shapes figure's rectangle (layout bbox, fitted into the region)", () => {
  const TOL = 0.2; // inches: painter text boxes may poke slightly past the layout bbox
  for (const [name, spec] of [["xychart", XY], ["radar", RADAR]] as const) {
    for (const region of [undefined, { x: 6.9, y: 1.6, w: 5.9, h: 5.2 }]) {
      it(`${name}${region ? " (beside text, region)" : " (solo)"}: rect encloses what the painter draws`, () => {
        const rect = nativeChartRect(spec, region)!;
        const rec = new ExtentRecorder();
        paintDiagram(rec, spec, { theme, omitTitle: true, region });
        expect(rec.minX).toBeGreaterThanOrEqual(rect.x - TOL);
        expect(rec.minY).toBeGreaterThanOrEqual(rect.y - TOL);
        expect(rec.maxX).toBeLessThanOrEqual(rect.x + rect.w + TOL);
        expect(rec.maxY).toBeLessThanOrEqual(rect.y + rect.h + TOL);
        if (region) {
          expect(rect.x).toBeGreaterThanOrEqual(region.x - 1e-9);
          expect(rect.y).toBeGreaterThanOrEqual(region.y - 1e-9);
          expect(rect.x + rect.w).toBeLessThanOrEqual(region.x + region.w + 1e-9);
          expect(rect.y + rect.h).toBeLessThanOrEqual(region.y + region.h + 1e-9);
        }
      });
    }
  }

  // #566: the pie's layout bbox runs to SLIDE_W - 0.4 so the shapes legend text has room; a native chart
  // fills its frame and pins the legend to the frame's right edge, so that bbox left the legend far from the
  // pie. The pie frame instead stops at the native legend's estimated right edge (swatch + longest label).
  for (const region of [undefined, { x: 6.9, y: 1.6, w: 5.9, h: 5.2 }]) {
    it(`pie${region ? " (beside text, region)" : " (solo)"}: frame = pie + legend estimate, at the painter's scale`, () => {
      const rect = nativeChartRect(PIE, region)!;
      const lay = computePieLayout(PIE, EMBED_TOP);
      const t = region ? fitTransform(lay.bbox, region) : { scale: 1, offsetX: 0, offsetY: 0 };
      const X = (x: number) => x * t.scale + t.offsetX;
      const Y = (y: number) => y * t.scale + t.offsetY;
      // the left / top / bottom are the painter's (the pie sits where the shapes pie sits)
      expect(rect.x).toBeCloseTo(X(lay.bbox.minX), 9);
      expect(rect.y).toBeCloseTo(Y(lay.bbox.minY), 9);
      expect(rect.h).toBeCloseTo((lay.bbox.maxY - lay.bbox.minY) * t.scale, 9);
      // the right edge holds the pie + a legend of the longest label, but no more than a small margin past it
      const longest = Math.max(...lay.slices.map((sl) => estTextWidth(sl.label, 10) / 72));
      const legendRight = X(lay.legendX + 0.46 + longest);
      expect(rect.x + rect.w).toBeGreaterThanOrEqual(legendRight);
      expect(rect.x + rect.w).toBeLessThanOrEqual(legendRight + 0.5 * t.scale);
      expect(rect.x + rect.w).toBeLessThan(X(SLIDE_W - 0.4) - 1); // not stretched to the shapes bbox edge
      expect(rect.x + rect.w).toBeGreaterThan(X(lay.cx + lay.r)); // the pie itself is inside
    });
  }

  it("pie with very long labels: the frame never grows past the shapes bbox", () => {
    const long = parseDiagramJson(JSON.stringify({ type: "pie", direction: "TB", edges: [], nodes: [
      { id: "a", label: "長".repeat(80), value: 1 }, // ≈ 11 in at 10 pt — far past the slide's right edge
      { id: "b", label: "b", value: 1 },
    ] }));
    const rect = nativeChartRect(long)!;
    expect(rect.x + rect.w).toBeCloseTo(computePieLayout(long, EMBED_TOP).bbox.maxX, 9);
  });

  it("non-chart specs have no rect (null)", () => {
    expect(nativeChartRect(FLOW)).toBeNull();
  });
});
