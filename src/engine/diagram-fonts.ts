/**
 * diagram-fonts.ts — the ONE rule for the typefaces of a drawn diagram / shape chart (#605, R8). Pure (R2).
 *
 * Root cause (#605): the export painted every diagram with the built-in Midnight theme (Georgia / Calibri)
 * whatever the template, and PptxGenJS writes its single `fontFace` into `<a:latin>`, `<a:ea>` AND `<a:cs>` —
 * so Japanese text got `<a:ea typeface="Calibri">`, a font with no Japanese glyphs (LibreOffice then lays
 * the glyphs out with Calibri's metrics and draws them overlapping).
 *
 * Rule: heading = the theme's major font, body = the theme's minor font.
 *  - latin: the theme's `<a:latin>`; none (or only a theme reference such as `+mn-lt`) → Midnight's
 *    Georgia / Calibri, so an English template's latin look is unchanged.
 *  - ea: the theme's `<a:ea>` → else its `<a:font script="Jpan">` → else DEFAULT_EA_FONT (Yu Gothic).
 *
 * How it reaches the output: the painter is handed font REFERENCES (OOXML's own `+mj-lt` / `+mn-lt`) instead
 * of names, and each draw target resolves a reference through `resolveDiagramFace` — the SVG preview into a
 * CSS font-family (latin, ea, CJK fallback), the PPTX export by rewriting the shapes' `<a:latin>/<a:ea>/<a:cs>`
 * (`applyDiagramFonts`). References keep a heading run and a body run apart even when both share one latin
 * name but differ in ea, which matching by name could not. Text measuring never reads the face, so the
 * geometry is unchanged (R5).
 */
import type { ThemeConfig } from "./theme";
import type { ThemeFonts } from "./template-loader";
import { DEFAULT_EA_FONT } from "./font-stack";

export { DEFAULT_EA_FONT };

/** The concrete typefaces a diagram is drawn with. */
export interface DiagramFonts {
  heading: string;
  body: string;
  headingEa: string;
  bodyEa: string;
}

/** OOXML theme font references (ECMA-376 §20.1.4.1.16 latin) — what the painter writes in place of a name. */
export const MAJOR_FONT_REF = "+mj-lt";
export const MINOR_FONT_REF = "+mn-lt";

const MIDNIGHT_HEADING = "Georgia"; // theme.ts defaultFonts() — the latin look of every English template so far
const MIDNIGHT_BODY = "Calibri";

/** A real typeface name (not empty, not a `+mj-lt` / `+mn-ea`-style theme reference). */
const real = (name: string | undefined): string | undefined => (name && !name.startsWith("+") ? name : undefined);

/** The diagram's typefaces for a template's theme fontScheme (undefined → Midnight + the default ea). */
export function diagramFontsFor(tf: ThemeFonts | undefined): DiagramFonts {
  return {
    heading: real(tf?.majorLatin) ?? MIDNIGHT_HEADING,
    body: real(tf?.minorLatin) ?? MIDNIGHT_BODY,
    headingEa: real(tf?.majorEa) ?? real(tf?.majorJpan) ?? DEFAULT_EA_FONT,
    bodyEa: real(tf?.minorEa) ?? real(tf?.minorJpan) ?? DEFAULT_EA_FONT,
  };
}

/** `theme` with its heading/body fonts replaced by the references the targets resolve (mono kept). */
export function withFontRefs(theme: ThemeConfig): ThemeConfig {
  return { ...theme, fonts: { ...theme.fonts, heading: MAJOR_FONT_REF, body: MINOR_FONT_REF } };
}

/** `theme` with the concrete latin names — for PptxGenJS's native chart, which takes one name per role. */
export function withLatinFonts(theme: ThemeConfig, fonts: DiagramFonts): ThemeConfig {
  return { ...theme, fonts: { ...theme.fonts, heading: fonts.heading, body: fonts.body } };
}

/** A painted face → its (latin, ea). A reference resolves through `fonts`; any other name (e.g. the mono
 *  face, or every face when no fonts were given) is returned as is, with no ea. */
export function resolveDiagramFace(face: string, fonts: DiagramFonts | undefined): { latin: string; ea?: string } {
  if (fonts && face === MAJOR_FONT_REF) return { latin: fonts.heading, ea: fonts.headingEa };
  if (fonts && face === MINOR_FONT_REF) return { latin: fonts.body, ea: fonts.bodyEa };
  return { latin: face };
}

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Rewrite the PptxGenJS shape XML's font references into real names: `<a:latin>` / `<a:cs>` get the
 *  latin face, `<a:ea>` the Japanese one. Only the `typeface` attribute changes. */
export function applyDiagramFonts(shapeXml: string, fonts: DiagramFonts): string {
  return shapeXml.replace(/<a:(latin|ea|cs) typeface="(\+m[jn]-lt)"/g, (_m, tag: string, ref: string) => {
    const r = resolveDiagramFace(ref, fonts);
    return `<a:${tag} typeface="${escAttr(tag === "ea" ? r.ea ?? r.latin : r.latin)}"`;
  });
}
