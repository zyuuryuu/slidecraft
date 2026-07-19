/**
 * font-stack.ts — CJK-aware CSS `font-family` fallback resolution (pure, R2: no DOM/Tauri).
 *
 * Root cause (#192 / #115-a): SlideCard (SlidePreview.tsx) and the shared SVG text painter
 * (svg-writer.ts) both emitted a bare `${fontName}, sans-serif` — a single Latin font name with a
 * generic sans-serif tail. On a machine that doesn't have the exact named font installed (any non-
 * Windows machine, or a Windows machine missing an optional East-Asian language pack), the browser
 * falls straight to whatever CJK font IS present, or to a Latin sans-serif that can't render CJK
 * glyphs at all (tofu). `template-loader.ts` already extracts the OOXML theme's `<a:ea>` (East-Asian)
 * typeface — the one that actually carries the visible Japanese brand font — but it never reached the
 * placeholder style used at render time. This module: (a) classifies a font name as gothic or mincho
 * so the RIGHT fallback family is picked, (b) builds an ordered fallback chain of widely-installed CJK
 * fonts so most machines land on a real CJK glyph before ever reaching the generic keyword.
 */

export type CjkClass = "gothic" | "mincho";

// A name containing this substring (case-insensitive for the ASCII form) is treated as a Mincho
// (serif) CJK design. "mincho" alone doesn't collide with "sans-serif"/"gothic" names.
const MINCHO_HINT = "mincho";
const MINCHO_HINT_JA = "明朝";

export function classifyCjkFont(name: string | undefined): CjkClass {
  if (!name) return "gothic";
  return name.toLowerCase().includes(MINCHO_HINT) || name.includes(MINCHO_HINT_JA) ? "mincho" : "gothic";
}

// Ordered by real-world install base across Windows/macOS/Linux, ending in the CSS generic so an
// unmatched environment still gets SOME serif/sans-serif rather than an unstyled fallback.
const GOTHIC_FALLBACK = ["Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Meiryo", "sans-serif"];
const MINCHO_FALLBACK = ["Yu Mincho", "Hiragino Mincho ProN", "Noto Serif CJK JP", "MS Mincho", "serif"];

const GENERIC_KEYWORDS = new Set(["serif", "sans-serif", "system-ui", "monospace", "cursive", "fantasy"]);

/** Quote a font-family token per CSS syntax (spaces/quotes/non-ASCII require quoting); leave CSS
 *  generic keywords bare. */
function quoteFont(name: string): string {
  if (GENERIC_KEYWORDS.has(name)) return name;
  return /[\s"'.]|[^\x20-\x7e]/.test(name) ? `"${name.replace(/"/g, '\\"')}"` : name;
}

/**
 * Build an ordered CSS `font-family` value: the declared Latin typeface first (so Latin runs keep
 * their exact brand font), then the East-Asian typeface if the template declared one, then a
 * gothic/mincho-classified fallback chain (classified from the ea name when present, else from the
 * Latin name itself) ending in the matching CSS generic. Deduplicated case-insensitively.
 */
export function cjkFontFamily(fontName: string, eaFontName?: string): string {
  const fallback = classifyCjkFont(eaFontName ?? fontName) === "mincho" ? MINCHO_FALLBACK : GOTHIC_FALLBACK;
  const latin = fontName.includes("Georgia") ? "Georgia" : fontName;
  const ordered = [latin, ...(eaFontName ? [eaFontName] : []), ...fallback];

  const seen = new Set<string>();
  const deduped = ordered.filter((n) => {
    const key = n.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.map(quoteFont).join(", ");
}
