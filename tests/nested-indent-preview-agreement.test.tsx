/**
 * nested-indent-preview-agreement.test.tsx — #577 / R8: 入れ子箇条の 1 段あたりの字下げ幅は
 * engine の規則（nested-level-font.nestedLevelIndentPt）1 か所に置き、プレビュー（SlidePreview）と
 * 生成テンプレ（template-writer の master bodyStyle marL）の両方がそれを使う。
 * writer 側の一致は template-writer-body-indent.test.ts が見る。ここはプレビュー側:
 *  (a) 描画された margin-left が段ごとに nestedLevelIndentPt(level) × scale/72 px と一致する。
 *  (b) SlidePreview が字下げ幅を直書きせず、engine の規則を import している（2 経路化の再発防止）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard } from "../src/components/SlidePreview";
import { loadTemplate, findLayout } from "../src/engine/template-loader";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";
import { parseMd } from "../src/engine/md-parser";
import { nestedLevelIndentPt } from "../src/engine/nested-level-font";

const SCALE = 96;
const MD = `# 入れ子

- Alpha
  - Beta
    - Gamma
      - Delta`;

describe("#577 R8: プレビューの入れ子字下げ == engine の規則", () => {
  it("margin-left（px）が段ごとに nestedLevelIndentPt(level) × scale/72", async () => {
    const tpl = await loadTemplate(
      await writeTemplate({ name: "Gen", fonts: { major: "Georgia", minor: "Calibri" }, palette: { ...MIDNIGHT_PALETTE } }),
    );
    const slide = parseMd(MD).slides[0];
    const html = renderToStaticMarkup(
      <SlideCard
        slide={slide}
        slideIndex={0}
        totalSlides={1}
        layout={findLayout(tpl, "Content.1Body.Single")}
        masterBgColor={tpl.masterBgColor}
        masterDecorations={tpl.masterDecorations}
        masterStaticTexts={tpl.masterStaticTexts}
        scale={SCALE}
        exportMode
      />,
    );
    const marginOf = (word: string): number => {
      const style = html.match(new RegExp(`<div style="(margin-bottom:0\\.15em[^"]*)">(?:<span[^>]*>[^<]*</span>)?<span>${word}</span>`))?.[1];
      expect(style, `${word} の段落`).toBeDefined();
      return Number(style!.match(/margin-left:([\d.]+)px/)?.[1] ?? 0);
    };
    ["Alpha", "Beta", "Gamma", "Delta"].forEach((w, level) => {
      expect(marginOf(w), `${w}（level ${level}）`).toBeCloseTo(nestedLevelIndentPt(level) * (SCALE / 72), 6);
    });
  });

  it("SlidePreview は字下げ幅を直書きせず nestedLevelIndentPt を engine から import する", () => {
    const src = readFileSync(resolve(__dirname, "../src/components/SlidePreview.tsx"), "utf8");
    expect(src).toMatch(/import \{[^}]*\bnestedLevelIndentPt\b[^}]*\} from "\.\.\/engine\/nested-level-font"/);
    expect(src).not.toMatch(/\bNEST_INDENT_PT\s*=/);
  });
});
