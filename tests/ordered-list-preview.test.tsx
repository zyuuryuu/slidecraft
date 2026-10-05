/**
 * ordered-list-preview.test.tsx — #394 SSR preview of numbered lists: an ordered item shows `N.` (the
 * same count the serializer writes, list-markers.orderedNumbers) in place of the master's bullet glyph;
 * `-` bullets keep the glyph exactly as before.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard } from "../src/components/SlidePreview";
import { loadTemplate, findLayout, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";
import { buildCatalog } from "../src/engine/template-catalog";

const TPL_PATH = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

describe("#394 SlidePreview: numbered list rendering (SSR)", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(TPL_PATH));
  });

  function markers(md: string): { marker: string; text: string }[] {
    const deck = parseMd(md);
    const slide = deck.slides[0];
    const layout = findLayout(tpl, autoSelectLayout(slide, 0, deck.slides.length, buildCatalog(tpl)));
    const html = renderToStaticMarkup(
      <SlideCard
        slide={slide}
        slideIndex={0}
        totalSlides={1}
        layout={layout}
        masterBgColor={tpl.masterBgColor}
        masterDecorations={tpl.masterDecorations}
        masterStaticTexts={tpl.masterStaticTexts}
        scale={96}
        exportMode
      />,
    );
    return [...html.matchAll(/<span style="margin-right:0\.4em">([^<]*)<\/span><span>([^<]*)<\/span>/g)]
      .map((m) => ({ marker: m[1], text: m[2] }));
  }

  it("ordered items are numbered per run (nested run restarts), `-` keeps the master glyph", () => {
    expect(markers("# 手順\n\n1. 準備\n  1. 確認\n  2. 承認\n2. 実行\n- 補足")).toEqual([
      { marker: "1.", text: "準備" },
      { marker: "1.", text: "確認" },
      { marker: "2.", text: "承認" },
      { marker: "2.", text: "実行" },
      { marker: "•", text: "補足" },
    ]);
  });
});
