/**
 * sample-native-charts.ts — #554 実機確認用: pie / xychart（棒＋折れ線）/ radar / flowchart の 4 枚デッキを
 * `charts: "native"` と既定 `"shapes"` の 2 通りで書き出す。PowerPoint で開いて、native 版のグラフが
 * 「データの編集」で開けること・見栄えを shapes 版と比べる。
 *
 * Usage:
 *   npx tsx scripts/sample-native-charts.ts [outDir]   # → <outDir>/native-charts.pptx, shapes-charts.pptx（既定 .）
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTemplate } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";
import { chartDeck, templateBytes } from "../tests/native-chart-fixtures";

const outDir = process.argv[2] ?? ".";
const tpl = await loadTemplate(templateBytes());
const counts = { native: 0, shapes: 0 };
writeFileSync(join(outDir, "native-charts.pptx"), await generatePptx(chartDeck(), tpl, undefined, { charts: "native", onFigure: (f) => counts[f]++ }));
writeFileSync(join(outDir, "shapes-charts.pptx"), await generatePptx(chartDeck(), tpl));
console.log(`wrote ${join(outDir, "native-charts.pptx")} (charts: native ${counts.native} / shapes ${counts.shapes}) and ${join(outDir, "shapes-charts.pptx")}`);
