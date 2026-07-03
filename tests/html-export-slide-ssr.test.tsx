/**
 * html-export-slide-ssr.test.tsx — S1 of the standalone HTML export
 * (docs/design/html-output.md). The HTML exporter reuses the EXACT SlideCard the
 * live preview uses, rendered to a static string via react-dom/server, so preview
 * and HTML can't diverge. This locks the new `exportMode` prop:
 *   - the card SSRs to positioned HTML (% geometry) with the slide's content, and
 *   - `exportMode` strips every editor-only affordance (hover cursor, selection
 *     border, click handler, synthetic slide-number) while staying purely additive
 *     (preview render is byte-for-byte unchanged when exportMode is off).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard } from "../src/components/SlidePreview";
import { loadTemplate, autoSelectLayout, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";

const CANON = resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx");
const MD = "# 四半期レビュー\n\n- 売上は前年比120%\n- 新規顧客が32社増加";
// A native ```diagram slide — double-quoted so the literal ``` fences don't close a template literal.
const DIAGRAM_MD =
  "# システム構成図\n\n```diagram\ntype: flowchart\ndirection: TB\ntitle: CRM\nnodes:\n" +
  "  - id: client\n    label: ブラウザ\n  - id: api\n    label: API Gateway\n" +
  "edges:\n  - from: client\n    to: api\n```\n";

describe("HTML export S1: SlideCard exportMode (SSR)", () => {
  let tpl: TemplateData;
  let cat: ReturnType<typeof buildCatalog>;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(CANON));
    cat = buildCatalog(tpl);
  });

  // Mirror how SlidePreview resolves the layout, then SSR the SAME SlideCard the preview mounts.
  function render(md: string, exportMode: boolean): string {
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
        exportMode={exportMode}
      />,
    );
  }

  it("SSR-renders the slide's content at %-based positions (self-contained markup)", () => {
    const html = render(MD, true);
    expect(html).toContain("四半期レビュー");
    expect(html).toContain("売上は前年比120%");
    // Placeholder boxes are positioned as a % of the slide → resolution-independent.
    expect(html).toMatch(/left:[\d.]+%/);
    expect(html).toMatch(/top:[\d.]+%/);
  });

  it("exportMode strips editor chrome (hover cursor + synthetic slide-number)", () => {
    const html = render(MD, true);
    expect(html).not.toContain("cursor:pointer");
    expect(html).not.toContain("bottom:4px"); // the preview-only slide-number chip is gone
  });

  it("is purely additive — preview render (exportMode off) keeps the chrome", () => {
    const html = render(MD, false);
    expect(html).toContain("cursor:pointer");
    expect(html).toContain("bottom:4px"); // slide-number chip present in preview
  });

  // The crux of the whole approach: DiagramSvgOverlay uses hooks (useMemo/useRef) and
  // computes its SVG SYNCHRONOUSLY via renderDiagramToSvg — so it survives SSR, unlike
  // the async Mermaid fallback (that's S2). This proves native diagrams SSR for free.
  it("SSR-renders a native diagram slide as inline <svg> (DiagramSvgOverlay hooks path)", () => {
    const html = render(DIAGRAM_MD, true);
    expect(html).toContain("<svg");
    expect(html).toContain("ブラウザ"); // node label text is present in the embedded SVG
  });

  // S2: a NON-native ```mermaid (gitGraph/sankey/C4) can't render synchronously, so the export
  // pre-renders it to svgCache; MermaidDirect must then inline that cache under SSR (not an empty
  // box). This tests the inline path (the async mermaid.render itself is DOM-bound → browser-only).
  it("SSR inlines a pre-rendered non-native mermaid svgCache", () => {
    const deck = parseMd("# 履歴\n\n```mermaid\ngitGraph\n  commit\n  commit\n```");
    const slide = deck.slides[0];
    expect(slide.mermaidBlock).toBeDefined();
    // Simulate deck-html-export's pre-render step having filled svgCache.
    const cached = { ...slide, mermaidBlock: { ...slide.mermaidBlock!, svgCache: '<svg id="cachedgit"><text>COMMIT</text></svg>' } };
    const layout = findLayout(tpl, autoSelectLayout(cached, 0, 1, cat));
    const html = renderToStaticMarkup(
      <SlideCard
        slide={cached}
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
    expect(html).toContain("cachedgit"); // the pre-rendered SVG is inlined synchronously
    expect(html).toContain("COMMIT");
  });
});
