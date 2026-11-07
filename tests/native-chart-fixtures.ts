/**
 * native-chart-fixtures.ts — shared chart specs + a 4-slide chart deck for the #554 tests
 * (pptx-native-chart.test.ts / pptx-native-chart-export.test.ts). Not a test file itself.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { parseDiagramJson } from "../src/engine/schema";
import { diagramSpecToYaml } from "../src/engine/diagram-serialize";
import type { DeckIR } from "../src/engine/slide-schema";
import type { DiagramSpec } from "../src/engine/schema";

// import.meta.url (not __dirname) so scripts/sample-native-charts.ts can import this under tsx (ESM) too
export const TEMPLATE_PATH = fileURLToPath(new URL("./fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx", import.meta.url));
export const templateBytes = () => readFileSync(TEMPLATE_PATH);

export const PIE: DiagramSpec = parseDiagramJson(JSON.stringify({
  type: "pie", direction: "TB", title: "市場シェア",
  nodes: [
    { id: "a", label: "製品A", value: 42 },
    { id: "b", label: "製品B", value: 30 },
    { id: "z", label: "ゼロ", value: 0 }, // dropped by the layout (value ≤ 0) — the mapper must agree
    { id: "c", label: "その他", value: 28 },
  ],
  edges: [],
}));

export const XY: DiagramSpec = parseDiagramJson(JSON.stringify({
  type: "xychart", direction: "TB", title: "売上推移", nodes: [], edges: [],
  xychart: {
    xlabel: "四半期", ylabel: "百万円", ymin: 0,
    categories: ["Q1", "Q2", "Q3", "Q4"],
    series: [
      { kind: "bar", name: "売上", values: [120, 150, 170, 210] },
      { kind: "bar", name: "原価", values: [80, 90, 100, 120] },
      { kind: "line", name: "利益率", values: [40, 60, 70, 90] },
    ],
  },
}));

export const XY_BAR_ONLY: DiagramSpec = parseDiagramJson(JSON.stringify({
  type: "xychart", direction: "TB", nodes: [], edges: [],
  xychart: { ylabel: "件数", ymin: 0, ymax: 50, categories: ["A", "B", "C"], series: [{ kind: "bar", values: [10, 25, 40] }] },
}));

export const XY_LINE_ONLY: DiagramSpec = parseDiagramJson(JSON.stringify({
  type: "xychart", direction: "TB", nodes: [], edges: [],
  xychart: { categories: ["1月", "2月", "3月"], series: [{ kind: "line", name: "来場", values: [3, 5, 4] }] },
}));

export const RADAR: DiagramSpec = parseDiagramJson(JSON.stringify({
  type: "radar", direction: "TB", title: "スキル評価", nodes: [], edges: [],
  radar: {
    axes: ["設計", "実装", "テスト", "運用", "文書"], max: 5,
    series: [
      { name: "現状", values: [3, 4, 2, 3, 2] },
      { name: "目標", values: [4, 5, 4, 4, 6] }, // 6 > max — the painter clamps; data keeps 6
    ],
  },
}));

export const FLOW: DiagramSpec = parseDiagramJson(JSON.stringify({
  type: "flowchart", direction: "LR",
  nodes: [{ id: "a", label: "開始" }, { id: "b", label: "終了" }],
  edges: [{ from: "a", to: "b" }],
}));

/** One title + one figure per slide: pie / xychart / radar / flowchart (the flowchart stays shapes). */
export function chartDeck(): DeckIR {
  const slide = (title: string, spec: DiagramSpec) => ({
    layout: "auto",
    placeholders: [{ idx: "0", paragraphs: [{ segments: [{ text: title }] }] }],
    diagram: { yaml: diagramSpecToYaml(spec), placeholderIdx: "1" },
  });
  return { slides: [slide("円", PIE), slide("棒と線", XY), slide("レーダー", RADAR), slide("フロー", FLOW)] };
}
