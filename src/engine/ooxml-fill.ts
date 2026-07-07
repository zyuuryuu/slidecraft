/**
 * ooxml-fill.ts — PURE helpers for the two OOXML fills the preview extractor used to drop:
 * PICTURE fills (`<p:pic>` / `<a:blipFill>`, including the SVG `svgBlip` alternative and non-web
 * primary blips) and GRADIENT fills (`<a:gradFill>` → CSS). Split out of template-loader.ts (already
 * >400 lines, R1) and kept pure — string/zip in, plain data out; no DOM/Tauri (R2) — so the preview
 * and the HTML export share ONE implementation and can never diverge.
 */
import type JSZip from "jszip";
import { parseColorRef, resolveColor } from "./ooxml-resolve";

/** Web-renderable image extensions → MIME. Non-web formats (emf/wmf/wdp/tiff) are intentionally
 *  ABSENT: a browser `<img>` can't paint them, so a pic whose primary blip is one of those must fall
 *  back to its `svgBlip` SVG alternative (or be skipped) rather than render a broken image. */
export const IMG_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", bmp: "image/bmp", webp: "image/webp",
};

const round = (n: number): number => Math.round(n * 100) / 100;

/** Map an XML rels part → { relationshipId → target } for image/media relationships only. */
export function buildRelMap(relsXml: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    if (/image/i.test(r[0]) || /media\//.test(r[2])) m.set(r[1], r[2]);
  }
  return m;
}

/** Resolve a relationship id → the media bytes as a self-contained `data:` URI, or undefined when the
 *  target is missing OR a non-web format (emf/wmf/wdp/tiff) a browser can't paint. `relDir` is the
 *  owning part's directory (e.g. "ppt/slideLayouts") so a "../media/x.png" target resolves. */
export async function resolveEmbedDataUri(
  rId: string | undefined, relMap: Map<string, string>, relDir: string, zip: JSZip,
): Promise<string | undefined> {
  if (!rId) return undefined;
  const target = relMap.get(rId);
  if (!target) return undefined;
  const path = new URL(target, `file:///${relDir}/`).pathname.replace(/^\/+/, "");
  const file = zip.file(path);
  const mime = IMG_MIME[path.split(".").pop()?.toLowerCase() ?? ""];
  if (!file || !mime) return undefined;
  return `data:${mime};base64,${await file.async("base64")}`;
}

/** The primary `<a:blip r:embed>` and the `<asvg:svgBlip r:embed>` SVG alternative of a pic/blipFill
 *  fragment. PowerPoint writes the raster as the primary and the SVG as an ext; a non-web primary
 *  (EMF/WMF/wdp) is only renderable via its svgBlip, so the caller tries primary then svg. */
export function blipEmbedIds(fragment: string): { primary?: string; svg?: string } {
  return {
    primary: fragment.match(/<a:blip[^>]*\br:embed="([^"]+)"/)?.[1],
    svg: fragment.match(/svgBlip[^>]*\br:embed="([^"]+)"/)?.[1],
  };
}

/** Resolve a `<p:pic>` / `<a:blipFill>` fragment to a renderable `data:` URI, preferring the primary
 *  blip and falling back to the svgBlip when the primary is a non-web format (or absent). */
export async function resolveBlipFillSrc(
  fragment: string, relMap: Map<string, string>, relDir: string, zip: JSZip,
): Promise<string | undefined> {
  const { primary, svg } = blipEmbedIds(fragment);
  return (await resolveEmbedDataUri(primary, relMap, relDir, zip))
    ?? (await resolveEmbedDataUri(svg, relMap, relDir, zip));
}

/** Convert the FIRST `<a:gradFill>` in `fragment` (scope it yourself) into a CSS `linear-gradient` +
 *  its first stop color (a representative solid for a shape rendered as an SVG polygon/path). Returns
 *  undefined when there is no gradient or fewer than two resolvable stops. */
export function gradFillCss(
  fragment: string, theme: Record<string, string>,
): { css: string; first: string } | undefined {
  const grad = fragment.match(/<a:gradFill\b[\s\S]*?<\/a:gradFill>/)?.[0];
  if (!grad) return undefined;
  const stops: { color: string; pos: number }[] = [];
  for (const gs of grad.matchAll(/<a:gs\b[^>]*\bpos="(\d+)"[^>]*>([\s\S]*?)<\/a:gs>/g)) {
    const color = resolveColor(parseColorRef(gs[2]), { theme });
    if (color) stops.push({ color, pos: parseInt(gs[1]) / 1000 }); // pos = 1000ths of a percent
  }
  if (stops.length < 2) return undefined;
  // OOXML `<a:lin ang>` is 60000ths of a degree, clockwise from 3 o'clock (east). CSS gradient angle
  // is clockwise from 12 o'clock, so east(0°)→CSS 90deg ⇒ cssDeg = oxmlDeg + 90. Absent `<a:lin>`
  // (e.g. a path/radial gradient) → default to top→bottom (CSS 180deg).
  const angRaw = grad.match(/<a:lin\b[^>]*\bang="(-?\d+)"/)?.[1];
  const oxmlDeg = angRaw ? parseInt(angRaw) / 60000 : 90;
  const cssDeg = (((oxmlDeg + 90) % 360) + 360) % 360;
  const css = `linear-gradient(${round(cssDeg)}deg, ${stops.map((s) => `#${s.color} ${round(s.pos)}%`).join(", ")})`;
  return { css, first: stops[0].color };
}

/** The `<p:bg>` picture fill of a layout/master as a `data:` URI, or undefined (not a blipFill bg). */
export async function backgroundImageSrc(
  xml: string, relMap: Map<string, string>, relDir: string, zip: JSZip,
): Promise<string | undefined> {
  const bg = xml.match(/<p:bg>[\s\S]*?<\/p:bg>/)?.[0];
  if (!bg || !/<a:blipFill\b/.test(bg)) return undefined;
  return resolveBlipFillSrc(bg, relMap, relDir, zip);
}

/** The `<p:bg>` gradient fill of a layout/master as a CSS `linear-gradient`, or undefined. */
export function backgroundGradientCss(xml: string, theme: Record<string, string>): string | undefined {
  const bg = xml.match(/<p:bg>[\s\S]*?<\/p:bg>/)?.[0];
  return bg ? gradFillCss(bg, theme)?.css : undefined;
}
