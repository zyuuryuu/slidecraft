/**
 * ooxml-resolve.ts — the small, PURE primitives that make OOXML resolution happen ONE way.
 *
 * The preview used to re-implement PowerPoint's slide→layout→master→theme inheritance with a
 * different ad-hoc fallback per visual property (geometry, font, color, fill, bg, bullet), so every
 * new template exposed one property whose chain was wrong. These primitives centralize the two
 * operations every extractor needs — "resolve a color" and "fold an inheritance chain" — so the
 * failure surface is one tested place, not N. Pure (R2): string/number in, plain data out.
 */

export const EMU_PER_INCH = 914400;

export function emuToInch(emu: string | number | undefined): number {
  if (emu === undefined) return 0;
  const n = typeof emu === "string" ? parseInt(emu) : emu;
  return Number.isFinite(n) ? n / EMU_PER_INCH : 0;
}

/** First defined candidate — the inheritance fold. `resolve(own, inherited, default)`. */
export function resolve<T>(...cands: (T | undefined)[]): T | undefined {
  for (const c of cands) if (c !== undefined) return c;
  return undefined;
}

/** An unresolved color: an explicit sRGB hex, or a theme scheme token (dk1/lt1/tx1/accent1/…). */
export interface ColorRef {
  srgb?: string; // hex, no #, uppercase
  scheme?: string; // scheme token (may be a clrMap alias: tx1/bg1/tx2/bg2)
}

/** What resolveColor needs: theme scheme colors keyed by slot AND by clrMap alias (see buildThemeCtx). */
export interface ClrCtx {
  theme: Record<string, string>;
}

/** The FIRST color node in an XML fragment as a ColorRef (unresolved), or undefined. Callers scope
 *  `fragment` to the region they mean (a fill region, a line, a text run) so the wrong color is never
 *  picked up — this replaces the old "first srgbClr anywhere in the shape" hack. */
export function parseColorRef(fragment: string): ColorRef | undefined {
  const m = fragment.match(/<a:(srgbClr|schemeClr) val="([A-Za-z0-9]+)"/);
  if (!m) return undefined;
  return m[1] === "srgbClr" ? { srgb: m[2].toUpperCase() } : { scheme: m[2] };
}

/** ColorRef → hex (no #). A scheme token resolves through the theme map (which already folds in the
 *  master clrMap aliases). Returns undefined when a scheme token isn't in the theme. */
export function resolveColor(ref: ColorRef | undefined, ctx: ClrCtx): string | undefined {
  if (!ref) return undefined;
  if (ref.srgb) return ref.srgb;
  if (ref.scheme) return ctx.theme[ref.scheme];
  return undefined;
}

/** sRGB relative luminance 0..1 — used ONLY to decide "is this background dark" (never to auto-flip a
 *  color, which would make the preview disagree with the faithful export). */
export function luminance(hex: string): number {
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n)) return 1;
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function isDark(hex: string): boolean {
  return luminance(hex) < 0.5;
}
