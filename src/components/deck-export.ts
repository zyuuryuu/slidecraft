/**
 * deck-export.ts — Render a deck to a downloadable .pptx.
 *
 * Each ```mermaid block is pre-rendered to SVG with the SAME config as the
 * on-screen preview, then rasterised by the browser's own canvas so the embedded
 * image is pixel-faithful to the preview (WYSIWYG: preview === output). Split out
 * of the deck controller to keep that hook within the 400-line rule (R1).
 */
import { generatePptx } from "../engine/placeholder-filler";
import type { DeckIR } from "../engine/slide-schema";
import type { TemplateData } from "../engine/template-loader";
import { downloadBlob } from "../ipc/commands";
import { MERMAID_CONFIG, rasterizeSvgToPng } from "./mermaid";

export async function exportDeckToPptx(deck: DeckIR, templateData: TemplateData): Promise<void> {
  const { default: mermaidLib } = await import("mermaid");
  mermaidLib.initialize(MERMAID_CONFIG);
  const deckWithSvg: DeckIR = {
    ...deck,
    slides: await Promise.all(deck.slides.map(async (slide, i) => {
      if (!slide.mermaidBlock) return slide;
      try {
        const { svg } = await mermaidLib.render(`pptx-mmd-${i}`, slide.mermaidBlock.mermaid);
        return { ...slide, mermaidBlock: { ...slide.mermaidBlock, svgCache: svg } };
      } catch {
        return slide;
      }
    })),
  };
  const buffer = await generatePptx(deckWithSvg, templateData, rasterizeSvgToPng);
  downloadBlob(buffer as unknown as Uint8Array, "slides_output.pptx");
}
