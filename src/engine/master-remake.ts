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
import type { TemplateData, ThemeFonts } from "./template-loader";
import { MIDNIGHT_PALETTE, type TemplateSpec, type LogoSpec } from "./template-writer";

/**
 * Resolve an OOXML theme-font reference to a real typeface. A master placeholder often fonts via
 * `+mj-lt` / `+mn-lt` (major/minor latin) or `+mj-ea` / `+mn-ea` (East-Asian) — a POINTER into the
 * theme's fontScheme, NOT a usable name. Capturing the raw token would (a) show "+mj-lt" in the intake
 * summary and (b) write a broken `<a:latin typeface="+mj-lt"/>` into the re-made theme. Resolve it to
 * the theme's actual font; if the theme lacks it, fall back to any real theme font, then "Arial" — so
 * we NEVER emit or display a token.
 */
export function resolveFontToken(name: string, tf: ThemeFonts | undefined): string {
  if (!name.startsWith("+")) return name;
  const byToken: Record<string, string | undefined> = {
    "+mj-lt": tf?.majorLatin,
    "+mn-lt": tf?.minorLatin,
    "+mj-ea": tf?.majorEa ?? tf?.majorLatin,
    "+mn-ea": tf?.minorEa ?? tf?.minorLatin,
  };
  const resolved = byToken[name] ?? tf?.majorLatin ?? tf?.minorLatin ?? "Arial";
  // Guard against a theme that itself stores a token (rare/malformed) — never return a "+…" name.
  return resolved.startsWith("+") ? "Arial" : resolved;
}
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

/** Chroma 0..1 (max−min of RGB channels); 0 = a perfect gray. */
function chroma(hex: string): number {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** The most desaturated (gray) theme accent — a template's own neutral for weak/meta text. Real
 *  corporate palettes carry a gray accent (CX = accent4 #9E9EA2); prefer it over a generic default. */
function grayAccent(th: Record<string, string>): string | undefined {
  const grays = ["accent4", "accent1", "accent2", "accent3", "accent5", "accent6"]
    .map((k) => norm(th[k]))
    .filter((c): c is string => !!c && chroma(c) < 0.15)
    .sort((a, b) => chroma(a) - chroma(b));
  return grays[0];
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

  // Body text = the theme's designated text color (tx1) — CX's real body ink is #282828, not the
  // master's declared navy. Fall back to the master body style, then a contrast-safe ink.
  const bodyText = readable(norm(th.tx1) ?? tpl.masterBodyStyle.fontColor, canvas);
  const palette: Record<PaletteKey, string> = {
    background,
    canvas,
    titleText: ink(background), // title sits on the dark header bar / dark layout
    bodyText,
    subtle: isDark(background) ? "CBD5E1" : "475569", // subtitle/meta on the dark background
    muted: grayAccent(th) ?? "94A3B8", // weak text (sources, page numbers) — the theme's own gray
    accent,
    accent2,
    emphasis: readable(background, canvas), // big-number emphasis on the canvas (brand dark on light)
  };

  const major = resolveFontToken(tpl.masterTitleStyle.fontName || tpl.masterBodyStyle.fontName || "Arial", tpl.themeFonts);
  const minor = resolveFontToken(tpl.masterBodyStyle.fontName || tpl.masterTitleStyle.fontName || "Arial", tpl.themeFonts);
  // "Flat" design: the source titles content in a DARK ink on a LIGHT canvas (no dark header bar —
  // CX's clean white content slides). Then our light layouts drop the header bar to match. When the
  // source titles in a light color (a bar/dark-header design), keep the bar. Keyed on the master's
  // title color vs the canvas so it's robust to the specific hue.
  const titleC = norm(tpl.masterTitleStyle.fontColor);
  const flatContent = !!titleC && isDark(titleC) && !isDark(canvas);
  return {
    name: opts.name ?? "会社テンプレート (Re-make)",
    fonts: { major, minor },
    palette,
    ...(flatContent ? { flatContent: true } : {}),
  };
}

const RASTER_EXT: Record<string, LogoSpec["ext"]> = { png: "png", jpg: "jpeg", jpeg: "jpeg", gif: "gif" };

/**
 * Extract the source master's LOGO — the raster image referenced by the most `<p:pic>` shapes across
 * its layouts (a logo recurs on cover/section/closing; a one-off illustration doesn't). Reads the
 * bytes from the source zip so writeTemplate can re-embed it. Async (zip I/O). Returns undefined when
 * there's no usable raster logo (e.g. only SVG/EMF, or none). v1: raster only.
 */
export async function extractLogo(tpl: TemplateData): Promise<LogoSpec | undefined> {
  const zip = tpl.zip;
  const hits = new Map<string, { count: number; aspect: number }>(); // media target → usage
  for (const layout of tpl.layouts) {
    const relsFile = zip.file(`ppt/slideLayouts/_rels/slideLayout${layout.index}.xml.rels`);
    const xmlFile = zip.file(`ppt/slideLayouts/slideLayout${layout.index}.xml`);
    if (!relsFile || !xmlFile) continue;
    const rels = await relsFile.async("string");
    const xml = await xmlFile.async("string");
    const relMap = new Map<string, string>();
    for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      if (/media\//.test(m[2])) relMap.set(m[1], m[2]);
    }
    for (const pm of xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
      const pic = pm[0];
      const rId = pic.match(/r:embed="([^"]+)"/)?.[1];
      const target = rId ? relMap.get(rId) : undefined;
      if (!target || !RASTER_EXT[target.split(".").pop()?.toLowerCase() ?? ""]) continue;
      const ext = pic.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
      const aspect = ext && +ext[2] > 0 ? +ext[1] / +ext[2] : 3;
      const cur = hits.get(target);
      hits.set(target, { count: (cur?.count ?? 0) + 1, aspect: cur?.aspect ?? aspect });
    }
  }
  if (hits.size === 0) return undefined;
  const [target, meta] = [...hits.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const file = zip.file(target.replace(/^\.\.\//, "ppt/"));
  if (!file) return undefined;
  const bytes = await file.async("uint8array");
  const ext = RASTER_EXT[target.split(".").pop()!.toLowerCase()];
  return { bytes, ext, aspect: meta.aspect };
}
