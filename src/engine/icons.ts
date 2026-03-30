/**
 * Icon Manager — Resolves icon names to image data for embedding in PPTX.
 *
 * Handles:
 *   - Built-in icon name resolution (e.g. "router" → icons/router.svg)
 *   - SVG → PNG conversion using @resvg/resvg-js (WASM-based, no native deps)
 *   - In-memory caching to avoid repeated conversions
 *
 * Ported from Python diagram_icons.py
 */

import { readFileSync, existsSync, statSync } from "fs";
import { join, resolve, extname, basename } from "path";
import { Resvg } from "@resvg/resvg-js";
import { BUILTIN_ICONS } from "./schema";

// ── Paths ──

// Built-in icons directory — relative to project root
const ICONS_DIR = resolve(__dirname, "../../icons");

// Default render size for SVG → PNG conversion (pixels)
const DEFAULT_RENDER_SIZE = 128;

// ── In-memory cache ──

const pngCache = new Map<string, Uint8Array>();

// ── SVG → PNG conversion ──

export function svgToPng(
  svgData: string | Buffer,
  size: number = DEFAULT_RENDER_SIZE,
): Uint8Array {
  const svgStr = typeof svgData === "string" ? svgData : svgData.toString("utf-8");

  const resvg = new Resvg(svgStr, {
    fitTo: {
      mode: "width",
      value: size,
    },
    background: "rgba(0, 0, 0, 0)", // transparent background
  });

  const rendered = resvg.render();
  return rendered.asPng();
}

// ── Icon Resolution ──

export function resolveIconPath(icon: string): string | undefined {
  // Check if it's a built-in icon name
  if (BUILTIN_ICONS.has(icon)) {
    const svgPath = join(ICONS_DIR, `${icon}.svg`);
    if (existsSync(svgPath)) return svgPath;

    const pngPath = join(ICONS_DIR, `${icon}.png`);
    if (existsSync(pngPath)) return pngPath;

    return undefined;
  }

  // Treat as file path
  if (existsSync(icon)) {
    const ext = extname(icon).toLowerCase();
    if ([".svg", ".png", ".jpg", ".jpeg", ".gif", ".bmp"].includes(ext)) {
      return icon;
    }
  }

  return undefined;
}

// ── Cache key ──

function cacheKey(sourcePath: string, size: number): string {
  try {
    const stat = statSync(sourcePath);
    return `${sourcePath}:${stat.mtimeMs}:${stat.size}:${size}`;
  } catch {
    return `${sourcePath}:0:0:${size}`;
  }
}

// ── Main API ──

export function getIconPngData(
  icon: string,
  size: number = DEFAULT_RENDER_SIZE,
): Uint8Array | undefined {
  const sourcePath = resolveIconPath(icon);
  if (!sourcePath) return undefined;

  const ext = extname(sourcePath).toLowerCase();

  // If already PNG/raster, read and return raw bytes
  if ([".png", ".jpg", ".jpeg", ".gif", ".bmp"].includes(ext)) {
    const key = cacheKey(sourcePath, 0);
    if (pngCache.has(key)) return pngCache.get(key)!;

    const data = new Uint8Array(readFileSync(sourcePath));
    pngCache.set(key, data);
    return data;
  }

  // SVG → PNG conversion with caching
  const key = cacheKey(sourcePath, size);
  if (pngCache.has(key)) return pngCache.get(key)!;

  const svgData = readFileSync(sourcePath, "utf-8");
  const pngData = svgToPng(svgData, size);
  pngCache.set(key, pngData);
  return pngData;
}

/**
 * Get icon as a base64 data URI for embedding in PptxGenJS.
 * PptxGenJS accepts base64 image data via `slide.addImage({ data: "image/png;base64,..." })`.
 */
export function getIconBase64(
  icon: string,
  size: number = DEFAULT_RENDER_SIZE,
): string | undefined {
  const pngData = getIconPngData(icon, size);
  if (!pngData) return undefined;

  const base64 = Buffer.from(pngData).toString("base64");
  return `image/png;base64,${base64}`;
}

// ── Utility ──

export function listBuiltinIcons(): string[] {
  const available: string[] = [];
  for (const name of [...BUILTIN_ICONS].sort()) {
    const svgPath = join(ICONS_DIR, `${name}.svg`);
    const pngPath = join(ICONS_DIR, `${name}.png`);
    if (existsSync(svgPath) || existsSync(pngPath)) {
      available.push(name);
    }
  }
  return available;
}

export function clearCache(): void {
  pngCache.clear();
}
