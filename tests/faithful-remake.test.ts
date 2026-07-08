/**
 * faithful-remake.test.ts — Re-make v2 (ADR-0027): keep the source's visual layer (decorations /
 * geometry / backgrounds) and normalise only the theme fonts. Proves the brand decorations SURVIVE
 * (the whole point — the canonical Re-make discarded them) and theme-reference tokens resolve to real
 * font names, all while the result still loads healthy + binds like faithful Import.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, assessTemplateHealth } from "../src/engine/template-catalog";
import { faithfulRemake, faithfulFonts, rewriteThemeFonts } from "../src/engine/faithful-remake";

const CANON = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const KOUBUN = resolve("public/templates/slide/配布資料_公文書高密度_TemplateOnly.pptx");
const decoCount = (t: Awaited<ReturnType<typeof loadTemplate>>) => t.layouts.reduce((s, l) => s + l.decorations.length, 0);

describe("faithfulFonts / rewriteThemeFonts (pure)", () => {
  it("resolves +mj-lt tokens to the theme's real fonts and keeps EA", () => {
    const f = faithfulFonts({ majorLatin: "+mj-lt", minorLatin: "Calibri", majorEa: "游ゴシック Light", minorEa: "游ゴシック" });
    // +mj-lt with only a partial theme resolves via the fallback chain; a real name passes through.
    expect(f.minorLatin).toBe("Calibri");
    expect(f.majorEa).toBe("游ゴシック Light");
    expect(f.minorEa).toBe("游ゴシック");
    expect(f.majorLatin).not.toMatch(/^\+/); // never a raw token
  });

  it("rewriteThemeFonts swaps only the latin/ea typefaces, leaving the rest of the theme intact", () => {
    const theme =
      `<a:theme><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="C00000"/></a:accent1></a:clrScheme>` +
      `<a:fontScheme><a:majorFont><a:latin typeface="MS PGothic"/><a:ea typeface=""/></a:majorFont>` +
      `<a:minorFont><a:latin typeface="MS PGothic"/><a:ea typeface=""/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
    const out = rewriteThemeFonts(theme, { majorLatin: "Yu Gothic UI", minorLatin: "Yu Mincho", majorEa: "游ゴシック", minorEa: "游明朝" });
    expect(out).toContain(`<a:latin typeface="Yu Gothic UI"/><a:ea typeface="游ゴシック"/>`);
    expect(out).toContain(`<a:latin typeface="Yu Mincho"/><a:ea typeface="游明朝"/>`);
    expect(out).toContain(`<a:srgbClr val="C00000"/>`); // brand color untouched
  });
});

describe("faithfulRemake (round-trip on real templates)", () => {
  it("PRESERVES every decoration + geometry and stays healthy (Midnight, +mj-lt theme)", async () => {
    const before = await loadTemplate(readFileSync(CANON));
    const { bytes, fonts } = await faithfulRemake(readFileSync(CANON));
    const after = await loadTemplate(bytes);
    expect(after.layouts.length).toBe(before.layouts.length);
    expect(decoCount(after)).toBe(decoCount(before)); // visual layer intact
    // the token master font is resolved to a real name in the re-made theme
    expect(fonts.majorLatin).not.toMatch(/^\+/);
    expect(after.themeFonts.majorLatin).not.toMatch(/^\+/);
    expect(assessTemplateHealth(buildCatalog(after)).status).not.toBe("rejected");
  });

  it("keeps the 85 brand decorations of the 公文書 master (the canonical Re-make would drop them)", async () => {
    if (!existsSync(KOUBUN)) return; // bundled; skip if absent
    const before = await loadTemplate(readFileSync(KOUBUN));
    const { bytes } = await faithfulRemake(readFileSync(KOUBUN));
    const after = await loadTemplate(bytes);
    expect(decoCount(before)).toBeGreaterThan(50); // sanity: the brand really is in the decorations
    expect(decoCount(after)).toBe(decoCount(before)); // ALL preserved
    expect(after.layouts.map((l) => l.name)).toEqual(before.layouts.map((l) => l.name)); // same layouts, same names
    expect(assessTemplateHealth(buildCatalog(after)).status).not.toBe("rejected");
  });
});
