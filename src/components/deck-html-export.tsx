/**
 * deck-html-export.tsx — Render a deck to a self-contained standalone HTML string
 * (S3 of docs/design/html-output.md). Orchestrator layer (React/DOM allowed, R2):
 * SSRs the SAME SlideCard the live preview mounts — so the HTML can't diverge from
 * what the user sees — then wraps the slides in the shell (engine/html-shell.ts).
 *
 * The caller saves the string via the native Save dialog / browser download (see
 * ipc/commands saveTextFile), mirroring how deck-export.ts hands off PPTX bytes.
 *
 * NON-native ```mermaid (gitGraph/sankey/C4) still SSRs empty here — pre-rendering
 * that async fallback to SVG is S2 (mirrors deck-export.ts:18-29). Native diagrams,
 * tables, code and text all render synchronously and are covered now.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard, SLIDE_W, SLIDE_H } from "./SlidePreview";
import { buildCatalog } from "../engine/template-catalog";
import { autoSelectLayout, findLayout, type TemplateData } from "../engine/template-loader";
import { assembleHtmlDeck } from "../engine/html-shell";
import type { DeckIR } from "../engine/slide-schema";

/** px-per-inch the slides are rendered at; the CSS shell then scales the whole stage to fit. */
const SCALE = 96;

export function renderDeckToHtml(deck: DeckIR, template: TemplateData, opts: { title?: string } = {}): string {
  const catalog = buildCatalog(template);

  const slideHtmls = deck.slides.map((slide, i) => {
    // Resolve the layout exactly as SlidePreview does (autoSelectLayout honors/degrades pins),
    // so slide→layout→placeholder binding matches the on-screen preview.
    const layout = findLayout(template, autoSelectLayout(slide, i, deck.slides.length, catalog));
    return renderToStaticMarkup(
      <SlideCard
        slide={slide}
        slideIndex={i}
        totalSlides={deck.slides.length}
        layout={layout}
        masterBgColor={template.masterBgColor}
        masterDecorations={template.masterDecorations}
        masterStaticTexts={template.masterStaticTexts}
        scale={SCALE}
        exportMode
      />,
    );
  });

  return assembleHtmlDeck(slideHtmls, {
    title: opts.title,
    stageW: SLIDE_W * SCALE,
    stageH: SLIDE_H * SCALE,
  });
}
