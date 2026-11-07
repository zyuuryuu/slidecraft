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
 * Carries fonts + palette, plus the source logo (extractLogo → per-background variants, #118) which
 * writeTemplate injects onto the dark-family layouts. Background-image injection is not carried.
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
  // Carry the East-Asian (CJK) typefaces too — for Japanese masters the brand font lives in the theme's
  // <a:ea> slot (latin holds only the Western pairing font). Dropping these silently loses 游ゴシック etc.
  const majorEa = tpl.themeFonts.majorEa;
  const minorEa = tpl.themeFonts.minorEa ?? tpl.themeFonts.majorEa;
  // "Flat" design: the source titles content in a DARK ink on a LIGHT canvas (no dark header bar —
  // CX's clean white content slides). Then our light layouts drop the header bar to match. When the
  // source titles in a light color (a bar/dark-header design), keep the bar. Keyed on the master's
  // title color vs the canvas so it's robust to the specific hue.
  const titleC = norm(tpl.masterTitleStyle.fontColor);
  const flatContent = !!titleC && isDark(titleC) && !isDark(canvas);
  return {
    name: opts.name ?? "会社テンプレート (Re-make)",
    fonts: { major, minor, ...(majorEa ? { majorEa } : {}), ...(minorEa ? { minorEa } : {}) },
    palette,
    ...(flatContent ? { flatContent: true } : {}),
  };
}

const RASTER_EXT: Record<string, LogoSpec["ext"]> = { png: "png", jpg: "jpeg", jpeg: "jpeg", gif: "gif" };

/** Logo candidates per background (#118). Corporate masters often ship a dark-ink logo for light
 *  slides and a white knock-out for dark ones; a single most-used pick can put an invisible logo on a
 *  dark cover. One image used on both backgrounds fills both slots. */
export interface LogoVariants {
  dark?: LogoSpec; // the image most used on DARK-background layouts
  light?: LogoSpec; // the image most used on LIGHT-background layouts
}

/** The logo to put on the dark-family layouts (cover/section/closing): the dark variant, else the
 *  light one — which, when no image sits on a dark background, IS the overall most-used image, so a
 *  single-variant master re-makes byte-identically to the pre-#118 behavior. */
export function logoForDarkLayouts(v: LogoVariants | undefined): LogoSpec | undefined {
  return v?.dark ?? v?.light;
}

type Usage = { aspect: number; dark: number; light: number };

/** Most-used image on one background (stable on layout order for ties); undefined if none. */
function topFor(hits: Map<string, Usage>, key: "dark" | "light"): string | undefined {
  const used = [...hits.entries()].filter(([, u]) => u[key] > 0);
  return used.length ? used.sort((a, b) => b[1][key] - a[1][key])[0][0] : undefined;
}

/**
 * Extract the source master's LOGO variants — per background, the raster image referenced by the most
 * `<p:pic>` shapes on layouts of that background (a logo recurs on cover/section/closing; a one-off
 * illustration doesn't). A layout's background is its own solid `<p:bg>`, else the master's, judged
 * with the SAME `isDark` as the palette's brandDark (R8; picture/gradient backgrounds fall back to that
 * solid color). Reads the bytes from the source zip so writeTemplate can re-embed them. Async (zip
 * I/O). Returns undefined when there's no usable raster logo (e.g. only SVG/EMF, or none). Raster only.
 */
export async function extractLogo(tpl: TemplateData): Promise<LogoVariants | undefined> {
  const zip = tpl.zip;
  const masterBg = norm(tpl.masterBgColor) ?? "FFFFFF";
  const hits = new Map<string, Usage>(); // media target → usage per background
  for (const layout of tpl.layouts) {
    const relsFile = zip.file(`ppt/slideLayouts/_rels/slideLayout${layout.index}.xml.rels`);
    const xmlFile = zip.file(`ppt/slideLayouts/slideLayout${layout.index}.xml`);
    if (!relsFile || !xmlFile) continue;
    const bg = isDark(norm(layout.background) ?? masterBg) ? "dark" : "light";
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
      // aspect = the image's FIRST occurrence in layout order (whatever its background), as before.
      const cur = hits.get(target) ?? { aspect, dark: 0, light: 0 };
      cur[bg] += 1;
      hits.set(target, cur);
    }
  }
  const read = async (target: string | undefined): Promise<LogoSpec | undefined> => {
    const file = target ? zip.file(target.replace(/^\.\.\//, "ppt/")) : null;
    if (!target || !file) return undefined;
    const ext = RASTER_EXT[target.split(".").pop()!.toLowerCase()];
    return { bytes: await file.async("uint8array"), ext, aspect: hits.get(target)!.aspect };
  };
  const dark = await read(topFor(hits, "dark"));
  const light = await read(topFor(hits, "light"));
  return dark || light ? { ...(dark ? { dark } : {}), ...(light ? { light } : {}) } : undefined;
}
