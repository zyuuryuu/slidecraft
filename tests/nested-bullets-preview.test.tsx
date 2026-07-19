/**
 * nested-bullets-preview.test.tsx — #103 SSR preview of nested bullets: 3-level indentation renders,
 * and font size follows the master's lvl2-4 style when the master defines one, else a step-down
 * fallback (template-loader.nestedFallbackFontSize / extractStyle) — never a flat, un-indented list.
 * Level 0 stays byte-identical to the pre-#103 render (no marginLeft/fontSize override at all).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard } from "../src/components/SlidePreview";
import { loadTemplate, findLayout, type TemplateData } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";
import { autoSelectLayout } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";

const TPL_PATH = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const MD = `# ネスト箇条書き

- ルート
  - レベル1
    - レベル2
      - レベル3`;

describe("#103 SlidePreview: nested bullet rendering (SSR)", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(TPL_PATH));
  });

  function render(md: string): string {
    const cat = buildCatalog(tpl);
    const deck = parseMd(md);
    const slide = deck.slides[0];
    const layout = findLayout(tpl, autoSelectLayout(slide, 0, deck.slides.length, cat));
    return renderToStaticMarkup(
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
  }

  it("renders all 4 lines (root + 3 nested levels) — no-silent-drop", () => {
    const html = render(MD);
    expect(html).toContain("ルート");
    expect(html).toContain("レベル1");
    expect(html).toContain("レベル2");
    expect(html).toContain("レベル3");
  });

  // Each nested-bullet paragraph renders as its OWN `<div style="margin-bottom:0.15em…">` (the
  // fixed "margin-bottom:0.15em" prefix is renderParagraph's first, always-present style — it
  // uniquely identifies a paragraph <div> vs. the placeholder's outer positioned wrapper <div>,
  // which never carries that property). #102 baked buChar "•" into this fixture's master bodyStyle,
  // so a bullet paragraph now renders an extra `<span style="margin-right:0.4em">•</span>` glyph
  // before the text span — optional here so a non-bullet paragraph (no glyph) still matches too.
  function paragraphStyles(html: string): { text: string; style: string }[] {
    return [...html.matchAll(/<div style="(margin-bottom:0\.15em[^"]*)">(?:<span style="margin-right:0\.4em">[^<]*<\/span>)?<span>([^<]*)<\/span><\/div>/g)]
      .map((m) => ({ style: m[1], text: m[2] }));
  }

  it("marginLeft strictly increases with nesting depth (levels 1→2→3), level 0 (root) gets none", () => {
    const html = render(MD);
    const paras = paragraphStyles(html).filter((p) => /^ルート|^レベル/.test(p.text));
    expect(paras.map((p) => p.text)).toEqual(["ルート", "レベル1", "レベル2", "レベル3"]);
    const marginOf = (style: string) => Number(style.match(/margin-left:([\d.]+)px/)?.[1] ?? 0);
    const margins = paras.map((p) => marginOf(p.style));
    expect(margins[0]).toBe(0); // ルート (level 0) — no override
    expect(margins[1]).toBeGreaterThan(margins[0]);
    expect(margins[2]).toBeGreaterThan(margins[1]);
    expect(margins[3]).toBeGreaterThan(margins[2]);
  });

  it("nested levels shrink font-size step-down (this fixture's master defines no lvl2-4 style)", () => {
    const html = render(MD);
    const paras = paragraphStyles(html).filter((p) => /^ルート|^レベル/.test(p.text));
    const sizeOf = (style: string) => style.match(/font-size:([\d.]+)px/)?.[1];
    // Root (level 0) carries no per-paragraph font-size override (byte-identical to pre-#103).
    expect(paras[0].style).toBe("margin-bottom:0.15em");
    const s1 = Number(sizeOf(paras[1].style));
    const s2 = Number(sizeOf(paras[2].style));
    const s3 = Number(sizeOf(paras[3].style));
    expect(s1).toBeGreaterThan(s2);
    expect(s2).toBeGreaterThan(s3);
  });

  it("a flat (unindented) bullet deck is byte-identical to the pre-#103 render", () => {
    const flatHtml = render("# タイトル\n\n- 項目A\n- 項目B");
    expect(flatHtml).not.toMatch(/margin-left/);
    const paras = paragraphStyles(flatHtml).filter((p) => /^項目/.test(p.text));
    expect(paras.map((p) => p.style)).toEqual(["margin-bottom:0.15em", "margin-bottom:0.15em"]);
  });
});
