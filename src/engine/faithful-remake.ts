/**
 * faithful-remake.ts — Re-make v2 (ADR-0027). Unlike the canonical Re-make (masterToTemplateSpec →
 * writeTemplate, which rebuilds on SlideCraft's own layouts and DISCARDS the source's decorations /
 * geometry / backgrounds), the faithful Re-make PRESERVES the source's visual layer byte-for-byte —
 * it keeps the source master/layouts/media XML exactly (so the 85 brand decorations of e.g. 公文書
 * survive) and only NORMALISES typography: the theme fontScheme is rewritten with resolved real font
 * names (`+mj-lt` → actual) and the East-Asian (CJK) brand font is guaranteed present.
 *
 * Placeholder ROLE identification (which frame is title/body) stays the loader's job (placeholderRole /
 * classifyLayout / ADR-0025 gated title recovery) — the geometry the faithful path preserves is exactly
 * what those heuristics key on, so binding works the same as faithful Import (the tested, trusted path).
 *
 * Pure engine logic (R2): JSZip + string surgery only, no DOM / Tauri.
 */
import JSZip from "jszip";
import { loadTemplate, type ThemeFonts } from "./template-loader";
import { resolveFontToken } from "./master-remake";

const THEME_PART = "ppt/theme/theme1.xml";

/** The clean fonts the re-made theme should carry: the source's OWN fonts, but with theme-reference
 *  tokens (`+mj-lt`) resolved to real names and the EA (CJK) slot filled from the theme when present. */
export interface FaithfulFonts {
  majorLatin: string;
  minorLatin: string;
  majorEa: string; // "" when the theme has no EA font (kept empty rather than guessed)
  minorEa: string;
}

/** Resolve the source theme's fonts to real names (no `+mj-lt` tokens), preserving the brand fonts. */
export function faithfulFonts(tf: ThemeFonts): FaithfulFonts {
  const majorLatin = resolveFontToken(tf.majorLatin ?? "+mj-lt", tf);
  const minorLatin = resolveFontToken(tf.minorLatin ?? "+mn-lt", tf);
  return {
    majorLatin,
    minorLatin,
    majorEa: tf.majorEa ?? "",
    minorEa: tf.minorEa ?? tf.majorEa ?? "",
  };
}

const escXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Rewrite ONLY the `<a:latin>`/`<a:ea>` typefaces inside the theme's major/minor font, leaving the
 *  rest of the theme (colors, format scheme) untouched — so brand colors and everything else survive. */
export function rewriteThemeFonts(themeXml: string, fonts: FaithfulFonts): string {
  const setFace = (block: string, latin: string, ea: string): string =>
    block
      .replace(/(<a:latin\b[^>]*\btypeface=")[^"]*(")/, `$1${escXml(latin)}$2`)
      .replace(/(<a:ea\b[^>]*\btypeface=")[^"]*(")/, `$1${escXml(ea)}$2`);
  return themeXml
    .replace(/<a:majorFont>[\s\S]*?<\/a:majorFont>/, (m) => setFace(m, fonts.majorLatin, fonts.majorEa))
    .replace(/<a:minorFont>[\s\S]*?<\/a:minorFont>/, (m) => setFace(m, fonts.minorLatin, fonts.minorEa));
}

export interface FaithfulRemakeResult {
  bytes: Uint8Array;
  fonts: FaithfulFonts;
}

/**
 * Faithful Re-make: keep the source PPTX's visual layer intact (master/layouts/media/decorations/
 * geometry/backgrounds) and rewrite only the theme fontScheme to resolved, real font names. The result
 * loads through the SAME gate as faithful Import (assessTemplateHealth), so the caller applies it the
 * same way. `name` is accepted for parity with the other intake paths (used by the caller for labelling).
 */
export async function faithfulRemake(source: ArrayBuffer | Uint8Array): Promise<FaithfulRemakeResult> {
  const tpl = await loadTemplate(source);
  const fonts = faithfulFonts(tpl.themeFonts);
  const zip = await JSZip.loadAsync(source);
  const themeFile = zip.file(THEME_PART);
  if (themeFile) {
    const themeXml = await themeFile.async("string");
    zip.file(THEME_PART, rewriteThemeFonts(themeXml, fonts));
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes, fonts };
}
