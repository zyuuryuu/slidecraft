/**
 * deck-export.ts — Render a deck to .pptx BYTES (the caller saves them via the
 * native Save dialog or a browser download — see ipc/commands saveBinaryFile).
 *
 * Each ```mermaid block is pre-rendered to SVG with the SAME config as the
 * on-screen preview, then rasterised by the browser's own canvas so the embedded
 * image is pixel-faithful to the preview (WYSIWYG: preview === output). Split out
 * of the deck controller to keep that hook within the 400-line rule (R1).
 */
import { generatePptx } from "../engine/placeholder-filler";
import type { DeckIR } from "../engine/slide-schema";
import { mermaidSources, withMermaidSvg } from "../engine/slide-figures";
import type { TemplateData } from "../engine/template-loader";
import { MERMAID_CONFIG, rasterizeSvgToPng } from "./mermaid";

export async function renderDeckToPptxBytes(deck: DeckIR, templateData: TemplateData): Promise<Uint8Array> {
  const { default: mermaidLib } = await import("mermaid");
  mermaidLib.initialize(MERMAID_CONFIG);
  const deckWithSvg: DeckIR = {
    ...deck,
    // Every ```mermaid of the slide (#392 段 2: a 2nd+ one too); one that fails to render is left without
    // svgCache (not drawn, as before).
    slides: await Promise.all(deck.slides.map(async (slide, i) => {
      const sources = mermaidSources(slide);
      if (sources.length === 0) return slide;
      const svgs = new Map<string, string>();
      for (const [k, src] of sources.entries()) {
        try {
          svgs.set(src, (await mermaidLib.render(k === 0 ? `pptx-mmd-${i}` : `pptx-mmd-${i}-${k}`, src)).svg);
        } catch {
          // left unrendered
        }
      }
      return svgs.size ? withMermaidSvg(slide, (m) => svgs.get(m)) : slide;
    })),
  };
  const buffer = await generatePptx(deckWithSvg, templateData, rasterizeSvgToPng);
  return buffer as unknown as Uint8Array;
}
