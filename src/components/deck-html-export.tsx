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
import { MERMAID_CONFIG } from "./mermaid";
import { buildCatalog } from "../engine/template-catalog";
import { autoSelectLayout, findLayout, type TemplateData } from "../engine/template-loader";
import { mermaidToDiagramSpec } from "../engine/mermaid-to-diagram";
import { assembleHtmlDeck, type Transition } from "../engine/html-shell";
import type { DeckIR } from "../engine/slide-schema";

/** px-per-inch the slides are rendered at; the CSS shell then scales the whole stage to fit. */
const SCALE = 96;

/**
 * Pre-render NON-native ```mermaid (gitGraph/sankey/C4) to a self-contained SVG so it inlines
 * synchronously under SSR (mermaid.render is async + DOM-bound, so it can't run during the render
 * pass — same approach deck-export.ts uses for PPTX). Native types are skipped: SlideCard renders
 * them via DiagramSvgOverlay synchronously. Runs in the WebView where `document` exists.
 */
async function preRenderNonNativeMermaid(deck: DeckIR): Promise<DeckIR> {
  const isNonNative = (s: DeckIR["slides"][number]) => s.mermaidBlock && !mermaidToDiagramSpec(s.mermaidBlock.mermaid);
  if (!deck.slides.some(isNonNative)) return deck;

  const { default: mermaidLib } = await import("mermaid");
  mermaidLib.initialize(MERMAID_CONFIG);
  const slides = await Promise.all(
    deck.slides.map(async (slide, i) => {
      if (!isNonNative(slide)) return slide;
      try {
        const { svg } = await mermaidLib.render(`html-mmd-${i}`, slide.mermaidBlock!.mermaid);
        return { ...slide, mermaidBlock: { ...slide.mermaidBlock!, svgCache: svg } };
      } catch {
        return slide; // render failed → left without svgCache (empty box), but we tried
      }
    }),
  );
  return { ...deck, slides };
}

export async function renderDeckToHtml(deck: DeckIR, template: TemplateData, opts: { title?: string; transition?: Transition } = {}): Promise<string> {
  const prepared = await preRenderNonNativeMermaid(deck);
  const catalog = buildCatalog(template);

  const slideHtmls = prepared.slides.map((slide, i) => {
    // Resolve the layout exactly as SlidePreview does (autoSelectLayout honors/degrades pins),
    // so slide→layout→placeholder binding matches the on-screen preview.
    const layout = findLayout(template, autoSelectLayout(slide, i, prepared.slides.length, catalog));
    return renderToStaticMarkup(
      <SlideCard
        slide={slide}
        slideIndex={i}
        totalSlides={prepared.slides.length}
        layout={layout}
        masterBgColor={template.masterBgColor}
        masterDecorations={template.masterDecorations}
        masterImages={template.masterImages}
        masterStaticTexts={template.masterStaticTexts}
        scale={SCALE}
        exportMode
      />,
    );
  });

  return assembleHtmlDeck(slideHtmls, {
    title: opts.title,
    transition: opts.transition,
    stageW: SLIDE_W * SCALE,
    stageH: SLIDE_H * SCALE,
    cspNonce: makeNonce(), // locks the exported .html under a CSP (ADR-0016 F2)
  });
}

/** Per-export random nonce for the exported document's CSP (the inline nav script gets it;
 *  injected inline script won't). The WebView always has crypto; the fallback is dead code. */
function makeNonce(): string {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, "");
  }
  return "nsc" + (c?.randomUUID ? c.randomUUID() : "fallback").replace(/-/g, "");
}
