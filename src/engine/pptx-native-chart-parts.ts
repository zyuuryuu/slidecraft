/**
 * pptx-native-chart-parts.ts — ネイティブ chart（#554 段 1）を PptxGenJS で作り、テンプレート由来の
 * デッキへ移植できるパーツに分ける。
 *
 * デッキ書き出し（placeholder-filler.generatePptx）は PptxGenJS の slide に直接描かず、scratch の
 * PptxGenJS 出力から XML を抜いてテンプレートの slide に組み込む（図形の図と同じ方式＝pptx-writer の
 * paintToShapeXml）。chart は slide XML の graphicFrame だけでなく chart パート・その rels・埋め込み
 * ワークブック（「データの編集」で開く .xlsx）を伴うので、それらをまとめて取り出し、デッキ内で一意な
 * 番号に付け替えて書き込む。
 *
 * Pure logic (R2): no DOM / Tauri（PptxGenJS / JSZip は pptx-writer と同じくエンジン内で使う）。
 */

import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { SLIDE_W, SLIDE_H } from "./layout-engine";
import type { Box } from "./draw-target";
import type { ThemeConfig } from "./theme";
import { parseDiagramYaml } from "./diagram-node-shrink";
import { chartSpecToNativeChart, nativeChartRect, type NativeChart } from "./pptx-native-chart";

/** slide rels 上の chart の関係 ID。1 slide に図は高々 1 つなので固定でよい（画像 rId2/3・notes rId4・
 *  リンク rId5〜 と衝突しない名前にする）。 */
export const CHART_REL_ID = "rIdChart";

const CHART_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
const CHART_CT = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
export const XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface NativeChartParts {
  /** `<p:graphicFrame>`（r:id は CHART_REL_ID）。shape id は呼び出し側で renumberShapeIds する。 */
  frameXml: string;
  chartXml: string;
  /** chart → 埋め込みワークブックの rels（Target は WORKBOOK_TOKEN を含む — writeNativeChart が置換）。 */
  chartRelsXml: string;
  workbook: Uint8Array;
}

const WORKBOOK_TOKEN = "__SC_WORKBOOK__";

/** NativeChart を矩形（inch）に置いた scratch PptxGenJS を書き出し、chart 1 個分のパーツを取り出す。 */
export async function buildNativeChartParts(nc: NativeChart, rect: Box): Promise<NativeChartParts> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "WIDE";
  const slide = pptx.addSlide();
  // PptxGenJS mutates what it is given (labels → string[][], _dataIndex, option defaults) — hand it copies so
  // the NativeChart stays as the mapper produced it.
  const nc2 = structuredClone(nc);
  const opts = { ...nc2.options, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  // Multi-type (combo) charts take `addChart(types, options)` — PptxGenJS reads the 2nd argument as the
  // options there (`tmpOpt = data || opt`), so passing a data array would swallow the options.
  if (nc2.parts) slide.addChart(nc2.parts, opts as unknown as unknown[]);
  else slide.addChart(nc2.type as PptxGenJS.CHART_NAME, nc2.data, opts);
  const zip = await JSZip.loadAsync((await pptx.write({ outputType: "uint8array" })) as Uint8Array);
  const read = (p: string) => {
    const f = zip.file(p);
    if (!f) throw new Error(`native chart: PptxGenJS output lacks ${p}`);
    return f;
  };
  const slideXml = await read("ppt/slides/slide1.xml").async("string");
  const frame = slideXml.match(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/)?.[0];
  const rid = frame?.match(/<c:chart\b[^>]*\br:id="([^"]+)"/)?.[1];
  if (!frame || !rid) throw new Error("native chart: no chart graphicFrame in PptxGenJS output");
  // PptxGenJS numbers charts with a MODULE-global counter (chart1, chart2… across instances) — follow the
  // slide's rel to the chart part rather than assuming chart1.
  const slideRels = await read("ppt/slides/_rels/slide1.xml.rels").async("string");
  const chartPath = slideRels.match(new RegExp(`Id="${rid}"[^>]*Target="/?(?:\\.\\./)?(?:ppt/)?(charts/chart\\d+\\.xml)"`))?.[1];
  if (!chartPath) throw new Error("native chart: slide rels lack the chart part");
  const rels = await read(`ppt/charts/_rels/${chartPath.slice("charts/".length)}.rels`).async("string");
  const wb = rels.match(/Target="\.\.\/embeddings\/([^"]+)"/)?.[1];
  if (!wb) throw new Error("native chart: chart rels lack the embedded workbook");
  return {
    frameXml: frame.replace(`r:id="${rid}"`, `r:id="${CHART_REL_ID}"`),
    chartXml: await read(`ppt/${chartPath}`).async("string"),
    chartRelsXml: rels.replace(`../embeddings/${wb}`, `../embeddings/${WORKBOOK_TOKEN}`),
    workbook: await read(`ppt/embeddings/${wb}`).async("uint8array"),
  };
}

/** 埋め込み図の YAML → ネイティブ chart のパーツ。段 1 の対象外・データ無し・不正 YAML は null
 *  （呼び出し側は従来の図形描画へフォールバックする — 不正 YAML はそちらが従来どおりエラーにする）。 */
export async function nativeChartPartsForYaml(yaml: string, theme: ThemeConfig, region?: Box): Promise<NativeChartParts | null> {
  const spec = parseDiagramYaml(yaml);
  if (!spec) return null;
  const nc = chartSpecToNativeChart(spec, theme);
  const rect = nativeChartRect(spec, region);
  return nc && rect ? buildNativeChartParts(nc, rect) : null;
}

/** デッキ内の chart 番号の起点: テンプレートが既に持つ chart / 埋め込みワークブックの最大番号（無ければ 0）。 */
export function maxChartNumber(zip: JSZip): number {
  let max = 0;
  for (const p of Object.keys(zip.files)) {
    const m = p.match(/^ppt\/charts\/chart(\d+)\.xml$/) ?? p.match(/^ppt\/embeddings\/Microsoft_Excel_Worksheet(\d+)\.xlsx$/);
    if (m) max = Math.max(max, parseInt(m[1]));
  }
  return max;
}

/** パーツを chart{n} としてデッキへ書き込む。返り値は slide rels に足す Relationship と
 *  [Content_Types] に足す Override（xlsx の Default は呼び出し側が XLSX_CT で宣言する）。 */
export function writeNativeChart(zip: JSZip, parts: NativeChartParts, n: number): { slideRel: string; ctOverride: string } {
  const wb = `Microsoft_Excel_Worksheet${n}.xlsx`;
  zip.file(`ppt/charts/chart${n}.xml`, parts.chartXml);
  zip.file(`ppt/charts/_rels/chart${n}.xml.rels`, parts.chartRelsXml.replace(WORKBOOK_TOKEN, wb));
  zip.file(`ppt/embeddings/${wb}`, parts.workbook);
  return {
    slideRel: `<Relationship Id="${CHART_REL_ID}" Type="${CHART_REL_TYPE}" Target="../charts/chart${n}.xml"/>`,
    ctOverride: `<Override PartName="/ppt/charts/chart${n}.xml" ContentType="${CHART_CT}"/>`,
  };
}
