/**
 * mermaid.ts — Shared Mermaid config + SVG→PNG rasterizer for WYSIWYG parity.
 *
 * The on-screen preview and the PPTX export MUST render Mermaid identically.
 * To guarantee that, both use the SAME config (MERMAID_CONFIG) and the export
 * rasterizes the preview's own SVG with the browser's renderer (rasterizeSvgToPng),
 * NOT a separate engine (resvg has no fonts → CJK/labels vanished, and a different
 * theme made the export diverge from the preview).
 */

import type { MermaidConfig } from "mermaid";

// Single source of truth for Mermaid rendering. htmlLabels:false keeps labels as
// SVG <text> (the browser <canvas> cannot rasterize <foreignObject> — it taints the
// canvas and drops the text). This is a rendering-mechanism choice, not a theme
// change: the template-conforming theme stays exactly as the preview shows it.
export const MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  theme: "dark",
  flowchart: { htmlLabels: false },
};

// Intrinsic pixel size of a Mermaid SVG (prefer viewBox; fall back to width/height).
function svgSize(svg: string): { w: number; h: number } {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (vb) return { w: parseFloat(vb[1]), h: parseFloat(vb[2]) };
  const w = svg.match(/width="([\d.]+)"/);
  const h = svg.match(/height="([\d.]+)"/);
  return { w: w ? parseFloat(w[1]) : 1200, h: h ? parseFloat(h[1]) : 800 };
}

/**
 * Rasterize an SVG string to PNG bytes using the browser's own renderer.
 * Produces an image pixel-faithful to the WYSIWYG preview (same fonts, colours,
 * text — including CJK). Runs in the browser and the Tauri WebView.
 */
export async function rasterizeSvgToPng(svg: string): Promise<Uint8Array> {
  const { w, h } = svgSize(svg);
  // Force explicit pixel dimensions so the <img> sizes deterministically.
  const sized = svg.replace(/<svg([^>]*?)>/, (_m, attrs: string) => {
    const cleaned = attrs.replace(/\s(?:width|height)="[^"]*"/g, "");
    return `<svg${cleaned} width="${w}" height="${h}">`;
  });

  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(sized);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Mermaid SVG failed to load for rasterization"));
    img.src = url;
  });

  // Render at ~1600px wide for crisp output in the slide.
  const scale = w > 0 ? Math.max(1, 1600 / w) : 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("canvas.toBlob produced no PNG");
  return new Uint8Array(await blob.arrayBuffer());
}
