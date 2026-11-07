/**
 * cjk-class.ts — THE single entry for "which CJK font class (gothic / mincho) does this text style
 * need" (pure, R2). #573 / R8: the preview painter (SlidePreview's font-family chain), the HTML
 * export's embedded @font-face subsets (deck-html-export) and the MCP raster's embedded faces
 * (slide-raster) all call this, so the class the CSS asks for is always the class that is embedded.
 *
 * A master style's `fontName` is a raw theme token (`+mj-lt` / `+mn-lt`) by the template-loader
 * contract (#532), so it MUST be resolved against the theme fontScheme (master-remake's
 * resolveFontToken — the one resolver) before classification: classifying the token string itself
 * always yields "gothic", which silently dropped the Serif subset for Mincho templates.
 *
 * Lives in its own module (not font-stack.ts) so the leaf font-stack stays free of the heavier
 * master-remake import graph; import direction is components/mcp → engine/cjk-class → font-stack,
 * master-remake.
 */
import { classifyCjkFont, type CjkClass } from "./font-stack";
import { resolveFontToken } from "./master-remake";
import type { TemplateData, ThemeFonts } from "./template-loader";

/** CJK class of one text style: the East-Asian typeface when declared (the loader never stores a
 *  token there), else the theme-resolved Latin typeface. */
export function cjkClassForStyle(style: { fontName: string; eaFontName?: string }, themeFonts: ThemeFonts | undefined): CjkClass {
  return classifyCjkFont(style.eaFontName ?? resolveFontToken(style.fontName, themeFonts));
}

/** The CJK classes a template's master title + body text need (what an export must embed). */
export function cjkClassesForTemplate(tpl: Pick<TemplateData, "masterTitleStyle" | "masterBodyStyle" | "themeFonts">): Set<CjkClass> {
  return new Set([cjkClassForStyle(tpl.masterTitleStyle, tpl.themeFonts), cjkClassForStyle(tpl.masterBodyStyle, tpl.themeFonts)]);
}
