/**
 * style-metrics-mermaid-715.test.ts — #715 所見 1: 画像面積比（imageArea）は export が描く <p:pic> を
 * すべて数える。非ネイティブ Mermaid（gitGraph 等）を PNG にしたもの（planSlideFigures の
 * `plan.mermaidPics`。export では `<p:pic name="MermaidImage">`）も含める（#671 の趣旨）。
 *
 * svgCache（Mermaid の SVG。GUI クライアントだけが埋める）は md からは来ないので、テストで deck に入れてから
 * 計測（measureSlides）と書き出し（generatePptx）を同じ deck で比べる。
 *
 *  (b') 一致テスト（R8）: Mermaid PNG を含むデッキでも、各スライドの imageArea ＝ <p:pic> の面積の和。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { generatePptx } from "../src/engine/placeholder-filler";
import { SLIDE_IN } from "../src/engine/visual-placement";
import type { DeckIR } from "../src/engine/slide-schema";
import * as S from "../src/mcp/session";
import { measureSlides, type SlideMetrics } from "../scripts/style-metrics";

const ROOT = resolve(__dirname, "..");
const TECH = resolve(ROOT, "public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx");
const EMU_PER_IN = 914400;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';
const GIT = "```mermaid\ngitGraph\n  commit\n  commit\n```"; // 非ネイティブ（DiagramSpec 形が無い）→ PNG
const PNG = readFileSync(resolve(ROOT, "samples/manuscript-07-campaign.md"), "utf8").match(/!\[[^\]]*\]\((data:image\/png;base64,[^)]+)\)/)![1];

const MD = [
  "# 表紙",
  `# 本文と図\n\n- 左の本文\n\n${GIT}`,
  `# 図と画像\n\n${GIT}\n\n![写真](${PNG})`,
  `# 図だけ\n\n${GIT}`,
].join("\n\n---\n\n");

/** svgCache を全 Mermaid 図に入れる（GUI クライアントがラスタ化の前に埋めるのと同じ状態）。 */
const withSvg = (deck: DeckIR): DeckIR => ({
  ...deck,
  slides: deck.slides.map((s) => ({
    ...s,
    ...(s.mermaidBlock ? { mermaidBlock: { ...s.mermaidBlock, svgCache: SVG } } : {}),
    ...(s.figures ? { figures: s.figures.map((f) => (f.kind === "mermaid" ? { ...f, svgCache: SVG } : f)) } : {}),
  })),
});

let metrics: SlideMetrics[];
let slideXml: string[];
beforeAll(async () => {
  const s = S.createSession(null);
  await S.newProject(s, readFileSync(TECH), MD);
  const deck = withSvg(s.deck!);
  metrics = measureSlides(deck, s.catalog!, s.template!);
  const z = await JSZip.loadAsync(await generatePptx(deck, s.template!, async () => new Uint8Array([1])));
  slideXml = await Promise.all(deck.slides.map((_, i) => z.file(`ppt/slides/slide${i + 1}.xml`)!.async("string")));
});

describe("(b') 一致テスト（R8）: Mermaid PNG 入りデッキでも imageArea ＝ <p:pic> の面積", () => {
  it("前提: Mermaid PNG（MermaidImage）が実際に書き出されている（空振りしない）", () => {
    expect(slideXml.filter((x) => x.includes('name="MermaidImage"')).length).toBeGreaterThanOrEqual(2);
  });

  it("各スライドの imageArea が <p:pic> の ext の面積の和と一致する", () => {
    const slideArea = SLIDE_IN.w * SLIDE_IN.h;
    for (const [i, xml] of slideXml.entries()) {
      const pics = xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? [];
      const area = pics.reduce((n, p) => {
        const m = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(p)!;
        return n + (Number(m[1]) / EMU_PER_IN) * (Number(m[2]) / EMU_PER_IN);
      }, 0);
      // imageArea は小数 3 桁に丸めた値なので、許容差は丸めの半単位（0.0005）。
      expect(Math.abs(metrics[i].imageArea - Math.min(1, area / slideArea)), `slide ${i + 1}`).toBeLessThanOrEqual(0.0005 + 1e-9);
    }
  });
});
