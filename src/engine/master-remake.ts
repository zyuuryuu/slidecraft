/**
 * master-remake.ts — extract a company slide master's THEME (fonts + colors) into a TemplateSpec, so
 * writeTemplate() re-emits SlideCraft's OWN canonical layouts wearing that theme.
 *
 * This is the "Re-make" intake mode, which COEXISTS with faithful Import: instead of adapting the
 * harness to a third-party master's placeholder structure (arbitrary idx numbering, inverted themes —
 * see ADR-0023), Re-make keeps only what companies actually care about — fonts, background, palette —
 * and fills OUR well-controlled layouts. That dissolves the whole class of "which idx is the body"
 * ambiguity by construction.
 *
 * Colors are mapped CONTRAST-SAFELY onto the 9 semantic palette keys (title text reads on the dark
 * header/background, body/emphasis read on the light canvas), so a re-made template can't reproduce
 * the invisible-text failures a raw master can. Pure logic (R2): no DOM / Tauri.
 *
 * v1 carries fonts + palette. Logo / background-image injection is a follow-up (needs the writer to
 * accept image parts); until then a re-made deck uses the extracted colors + fonts on clean layouts.
 */
import { isDark, luminance } from "./ooxml-resolve";
import type { TemplateData } from "./template-loader";
import { MIDNIGHT_PALETTE, type TemplateSpec } from "./template-writer";
import type { PaletteKey } from "./template-layout-library";

/** Normalize a hex to 6 upper-case digits without '#', or undefined. */
function norm(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const h = hex.replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(h) ? h : /^[0-9A-F]{3}$/.test(h) ? h.replace(/(.)/g, "$1$1") : undefined;
}

/** Contrast-safe ink for a background: white on dark, near-black on light. */
function ink(bg: string): string {
  return isDark(bg) ? "FFFFFF" : "1E293B";
}

/** Keep `color` if it clearly reads on `bg`; otherwise fall back to a contrast-safe ink. */
function readable(color: string | undefined, bg: string): string {
  const c = norm(color);
  if (c && Math.abs(luminance(c) - luminance(bg)) > 0.22) return c;
  return ink(bg);
}

/**
 * A dark brand color for dark/section layouts and the light-layout header bar. Prefer a dark layout's
 * OWN background (literally the company's "dark slide" color — e.g. CX Sample's midnight navy), else a
 * dark theme slot, else the canonical default. Most-used dark background wins (the signature one).
 */
function brandDark(tpl: TemplateData): string {
  const freq = new Map<string, number>();
  for (const l of tpl.layouts) {
    const c = norm(l.background);
    if (c && isDark(c)) freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  if (freq.size) return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  for (const key of ["tx2", "dk2", "accent1", "tx1", "dk1"]) {
    const c = norm(tpl.themeColors[key]);
    if (c && isDark(c)) return c;
  }
  return MIDNIGHT_PALETTE.background;
}

/**
 * Extract fonts + a contrast-safe 9-color palette from a loaded master. Feed the result to
 * writeTemplate() to mint a template-only .pptx with SlideCraft's canonical layouts in the company's
 * look. `opts.name` names the minted template.
 */
export function masterToTemplateSpec(tpl: TemplateData, opts: { name?: string } = {}): TemplateSpec {
  const th = tpl.themeColors;
  const canvas = norm(tpl.masterBgColor) ?? "FFFFFF"; // light content background (ADR-fix: real <p:bg>)
  const background = brandDark(tpl); // dark brand color (dark layouts + light-layout header bar)
  const accent = norm(th.accent1) ?? MIDNIGHT_PALETTE.accent;
  const accent2 = norm(th.accent2) ?? norm(th.accent1) ?? MIDNIGHT_PALETTE.accent2;

  const palette: Record<PaletteKey, string> = {
    background,
    canvas,
    titleText: ink(background), // title sits on the dark header bar / dark layout
    bodyText: readable(tpl.masterBodyStyle.fontColor, canvas), // body on the light canvas
    subtle: isDark(background) ? "CBD5E1" : "475569", // subtitle/meta on the dark background
    muted: "94A3B8", // weak text (sources, page numbers) — neutral gray reads on both
    accent,
    accent2,
    emphasis: readable(background, canvas), // big-number emphasis on the canvas (brand dark on light)
  };

  const major = tpl.masterTitleStyle.fontName || tpl.masterBodyStyle.fontName || "Arial";
  const minor = tpl.masterBodyStyle.fontName || major;
  return {
    name: opts.name ?? "会社テンプレート (Re-make)",
    fonts: { major, minor },
    palette,
  };
}
