/**
 * figures-golden-392.test.tsx — #392 段 2: golden（出力の sha256 を固定するスナップショット）を、複数ビジュアルの
 * 代表 3 スライド（図×2・表＋図・col 本文｜図）× 出荷テンプレ 3 本で追加する。
 *
 * - PPTX: 書き出した slide XML と rels。
 * - HTML: HTML 書き出しが使う SlideCard の SSR（exportMode）— プレビューと同じ描画。
 * - painter: 各図を、置かれた枠（figureRegions）に収めて描いた SVG（paintDiagram — PPTX・プレビュー共通の描画）。
 *
 * 構造の検査（両方描かれる・枠が重ならない）も併せて置き、sha の更新だけで挙動の後退がすり抜けないようにする。
 * 更新手順: 意図して出力を変えたときだけ `npx vitest run tests/figures-golden-392.test.tsx -u`。差分は書き出した
 * XML／HTML を開いて読んでから更新すること。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard } from "../src/components/SlidePreview";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate, autoSelectLayout, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { generatePptx } from "../src/engine/placeholder-filler";
import { figureRegions } from "../src/engine/visual-placement";
import { renderPaintToSvg } from "../src/engine/svg-writer";
import { paintDiagram } from "../src/engine/diagram-painter";
import { parseDiagramYaml } from "../src/engine/diagram-node-shrink";
import { midnightExecutive } from "../src/engine/theme";

const TPL_DIR = resolve(__dirname, "../public/templates/slide");
const TEMPLATES = [
  "ビジュアルデッキ_マガジン_TemplateOnly.pptx",
  "技術報告_スタンダード水色_TemplateOnly.pptx",
  "配布資料_公文書高密度_TemplateOnly.pptx",
];
const DIAG = (id: string, label: string) =>
  "```diagram\ntype: flowchart\ndirection: LR\nnodes:\n  - id: " + id + "\n    label: " + label + "\n  - id: " + id + "2\n    label: " + label + "の次\nedges:\n  - from: " + id + "\n    to: " + id + "2\n```";
const MD = [
  "# 複数ビジュアルの代表",
  `# 図が 2 つ\n\n${DIAG("a", "左の図")}\n\n${DIAG("b", "右の図")}`,
  `# 表と図\n\n| 指標 | 値 |\n|---|---|\n| 売上 | 120 |\n| 利益 | 30 |\n\n${DIAG("c", "図のノード")}`,
  `# col 本文｜図\n\n<!-- col -->\n- 左カラムの本文\n- 二行目\n\n<!-- col -->\n${DIAG("d", "右カラムの図")}`,
].join("\n\n---\n\n") + "\n";
const deck = parseMd(MD);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const titleOf = (i: number) => deck.slides[i].placeholders.find((p) => p.idx === "15")?.paragraphs[0]?.segments[0]?.text ?? "";
/** Each representative slide's visible texts (one per visual, in source order). */
const TEXTS: Record<number, string[]> = { 1: ["左の図", "右の図"], 2: ["売上", "図のノード"], 3: ["左カラムの本文", "右カラムの図"] };

const loaded: Record<string, TemplateData> = {};
beforeAll(async () => {
  for (const f of TEMPLATES) loaded[f] = await loadTemplate(readFileSync(resolve(TPL_DIR, f)));
});

const layoutOf = (tpl: TemplateData, i: number) => findLayout(tpl, autoSelectLayout(deck.slides[i], i, deck.slides.length, buildCatalog(tpl)))!;
const html = (tpl: TemplateData, i: number) =>
  renderToStaticMarkup(
    <SlideCard
      slide={deck.slides[i]}
      slideIndex={i}
      totalSlides={deck.slides.length}
      layout={layoutOf(tpl, i)}
      masterBgColor={tpl.masterBgColor}
      masterDecorations={tpl.masterDecorations}
      masterStaticTexts={tpl.masterStaticTexts}
      scale={96}
      exportMode
    />,
  );

for (const f of TEMPLATES) {
  describe(`#392 段 2 golden — ${f}`, () => {
    it("PPTX: slide XML / rels sha256, and every visual is drawn", async () => {
      const zip = await JSZip.loadAsync(await generatePptx(deck, loaded[f]));
      const out: Record<string, string> = {};
      for (const i of [1, 2, 3]) {
        const xml = await zip.file(`ppt/slides/slide${i + 1}.xml`)!.async("string");
        for (const t of TEXTS[i]) expect(xml, `${f} / ${titleOf(i)} / ${t}`).toContain(t);
        out[`slide${i + 1}.xml ${titleOf(i)}`] = sha(xml);
        out[`slide${i + 1}.xml.rels ${titleOf(i)}`] = sha(await zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`)!.async("string"));
      }
      expect(out).toMatchSnapshot();
    });

    it("HTML (SlideCard SSR = the preview): sha256, and every visual is drawn", () => {
      const out: Record<string, string> = {};
      for (const i of [1, 2, 3]) {
        const markup = html(loaded[f], i);
        for (const t of TEXTS[i]) expect(markup, `${f} / ${titleOf(i)} / ${t}`).toContain(t);
        out[`${i} ${titleOf(i)}`] = sha(markup);
      }
      expect(out).toMatchSnapshot();
    });

    it("painter: each diagram painted into its own region (regions are disjoint), sha256", () => {
      const out: Record<string, string> = {};
      for (const i of [1, 2, 3]) {
        const regions = figureRegions(deck.slides[i], layoutOf(loaded[f], i).placeholders);
        const boxes = regions.map((r) => r.ph!.style);
        expect(boxes.every(Boolean)).toBe(true);
        if (boxes.length === 2) expect(boxes[0].x + boxes[0].w <= boxes[1].x || boxes[1].x + boxes[1].w <= boxes[0].x).toBe(true); // side by side
        regions.forEach((r, k) => {
          if (r.figure.kind !== "diagram") return;
          const spec = parseDiagramYaml(r.figure.yaml)!;
          const svg = renderPaintToSvg((t) => paintDiagram(t, spec, { theme: midnightExecutive(), omitTitle: true, region: r.ph!.style }));
          out[`${i} ${titleOf(i)} #${k + 1}`] = sha(svg);
        });
      }
      expect(out).toMatchSnapshot();
    });
  });
}
