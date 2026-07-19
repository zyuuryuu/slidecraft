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
import { assembleHtmlDeck, type Transition, type EmbeddedFontFace } from "../engine/html-shell";
import { materializeDerivedSlides, sectionFooterFor } from "../engine/deck-sections";
import { serializeParagraphs } from "../engine/md-serializer-shared";
import { collectDeckText, deckUsesBold, deckHasCjkText } from "../engine/deck-text-collect";
import { resolveFontSubsetSource } from "../engine/font-subset-plan";
import { classifyCjkFont, embedFallbackFamily, type CjkClass } from "../engine/font-stack";
import { subsetFontToTtf } from "./font-subsetter";
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

/** Fetch the bundled variable-font source for `cjkClass` (font-subset-plan's asset path, #193) and
 *  subset it to `text` for each bold flag in `boldFlags` — the actual pinned weight always comes from
 *  resolveFontSubsetSource itself (single source of truth for the bold→wght mapping, R8), never a
 *  locally-duplicated 400/700 literal. Best-effort at every step (missing asset / WASM failure) —
 *  do-no-harm (#194): embedding is purely additive, so any failure here just skips that face and
 *  keeps the fallback stack. */
async function subsetEmbedFaces(cjkClass: CjkClass, boldFlags: boolean[], text: string): Promise<EmbeddedFontFace[]> {
  const { assetPath } = resolveFontSubsetSource(cjkClass, false);
  let sourceFont: Uint8Array;
  try {
    const res = await fetch(assetPath);
    if (!res.ok) return [];
    sourceFont = new Uint8Array(await res.arrayBuffer());
  } catch {
    return [];
  }

  const family = embedFallbackFamily(cjkClass);
  const faces: EmbeddedFontFace[] = [];
  for (const bold of boldFlags) {
    const { wght } = resolveFontSubsetSource(cjkClass, bold);
    try {
      const subset = await subsetFontToTtf(sourceFont, text, { wght });
      faces.push({ family, weight: wght, ttfBase64: bytesToBase64(subset) });
    } catch {
      // harfbuzz/WASM failure for this weight — skip it, the CSS fallback stack still renders (do-no-harm)
    }
  }
  return faces;
}

/** Which font classes (gothic/mincho) + weights the deck's title/body styles actually need embedded,
 *  fetched+subsetted, then returned as @font-face-ready faces. Skips entirely (AC2) when the deck's
 *  text has no CJK glyph at all — zero size cost for a non-CJK deck. */
async function buildEmbeddedFonts(deck: DeckIR, template: TemplateData): Promise<EmbeddedFontFace[]> {
  const text = collectDeckText(deck);
  if (!deckHasCjkText(text)) return [];

  const classes = new Set<CjkClass>([
    classifyCjkFont(template.masterTitleStyle.eaFontName ?? template.masterTitleStyle.fontName),
    classifyCjkFont(template.masterBodyStyle.eaFontName ?? template.masterBodyStyle.fontName),
  ]);
  const boldFlags = deckUsesBold(deck) ? [false, true] : [false];

  const faces: EmbeddedFontFace[] = [];
  for (const cjkClass of classes) faces.push(...(await subsetEmbedFaces(cjkClass, boldFlags, text)));
  return faces;
}

/** btoa needs a binary string; chunk the conversion so a large font buffer never blows the call
 *  stack via `String.fromCharCode(...bytes)` on the whole array at once. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export async function renderDeckToHtml(deck: DeckIR, template: TemplateData, opts: { title?: string; transition?: Transition } = {}): Promise<string> {
  // 派生スライド（<!-- toc -->）の内容を消費点で導出（#151）— PPTX/preview と同じ単一関数（R8）。
  const prepared = await preRenderNonNativeMermaid(materializeDerivedSlides(deck));
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
        masterBackgroundImage={template.masterBackgroundImage}
        masterBackgroundGradient={template.masterBackgroundGradient}
        masterDecorations={template.masterDecorations}
        masterImages={template.masterImages}
        masterStaticTexts={template.masterStaticTexts}
        scale={SCALE}
        sectionFooterText={sectionFooterFor(prepared, i)}
        exportMode
      />,
    );
  });

  // Runtime CJK subset embedding (#193/#194, default ON): collectDeckText runs on the MATERIALIZED
  // `prepared` deck, not the raw input — derived content (TOC title "目次", section-nav recap lists)
  // only exists post-materialize, and skipping that would leave those glyphs out of the subset.
  const embeddedFonts = await buildEmbeddedFonts(prepared, template);

  return assembleHtmlDeck(slideHtmls, {
    title: opts.title,
    transition: opts.transition,
    stageW: SLIDE_W * SCALE,
    stageH: SLIDE_H * SCALE,
    cspNonce: makeNonce(), // locks the exported .html under a CSP (ADR-0016 F2)
    // Speaker notes (#150): default-hidden panel, 'n' toggles. Plain Markdown text per slide.
    notes: prepared.slides.map((s) => (s.notes?.length ? serializeParagraphs(s.notes) : undefined)),
    embeddedFonts,
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
