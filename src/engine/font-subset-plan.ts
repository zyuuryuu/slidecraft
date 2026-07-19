/**
 * font-subset-plan.ts — maps a gothic/mincho classification (font-stack.ts / #192) + bold flag to
 * the bundled source font asset + variable-font weight to subset from (#193 / #115-b). Pure (R2):
 * no DOM/Tauri, no fetch — just which public/ asset path and `wght` pin a caller should use.
 *
 * The bundled sources (public/fonts/, see CREDITS.md there) are Noto Sans JP and Noto Serif JP,
 * each a variable font spanning the full weight axis — one file covers both Regular and Bold, so
 * the caller pins `wght` at subset time (subsetFontToTtf's `wght` option) rather than needing
 * separate static-weight files.
 */
import type { CjkClass } from "./font-stack";

export interface FontSubsetSource {
  /** public/ URL path (fetchable at runtime) of the bundled variable-font source. */
  assetPath: string;
  /** Variable-font `wght` axis value to pin before subsetting: 400 (Regular) or 700 (Bold). */
  wght: 400 | 700;
}

const GOTHIC_ASSET_PATH = "/fonts/NotoSansJP-Variable.ttf";
const MINCHO_ASSET_PATH = "/fonts/NotoSerifJP-Variable.ttf";

/** Resolve which bundled source font + weight to subset from, given a template's gothic/mincho
 *  classification and whether the run is bold. */
export function resolveFontSubsetSource(cjkClass: CjkClass, bold: boolean): FontSubsetSource {
  return {
    assetPath: cjkClass === "mincho" ? MINCHO_ASSET_PATH : GOTHIC_ASSET_PATH,
    wght: bold ? 700 : 400,
  };
}
