/**
 * builtin-template-title-contrast.test.ts — guardrail for Issue #274.
 *
 * The bundled Midnight Executive template shipped 19 layouts whose white title text (#FFFFFF) sat on a
 * white background with NO dark backdrop behind it (no header bar / no dark page fill), so the title
 * rendered white-on-white and was invisible in preview AND export. Parsing/binding were fine — only the
 * template asset was wrong (a stale/incomplete design, out of sync with the working layouts).
 *
 * This asserts the invariant every bundled template must hold: a LIGHT title placeholder must have a
 * DARK backdrop DIRECTLY behind it — either a dark deco shape covering its rect, a dark layout/master
 * background, or a full-bleed background image/gradient. Anything else = an unreadable title. Pure data
 * check over the loaded template (R2), so it catches the asset drifting out of sync again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadTemplate, type LayoutInfo, type PlaceholderInfo } from "../src/engine/template-loader";
import { placeholderRole } from "../src/engine/template-catalog";

const BUNDLED = [
  "Midnight_Executive_30_TemplateOnly.pptx",
  "配布資料_公文書高密度_TemplateOnly.pptx",
  "ビジュアルデッキ_マガジン_TemplateOnly.pptx",
  "技術報告_スタンダード水色_TemplateOnly.pptx",
];

/** Relative luminance (0–255) of a #RRGGBB (no '#'). */
function lum(hex: string): number {
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n)) return 255;
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/** Fraction of rect `a` covered by rect `b`. */
function coverFraction(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.max(1e-6, a.w * a.h);
}

const LIGHT = 160; // title text this bright needs a dark backdrop
const DARK = 128; // backdrop this dark counts as a dark backdrop

/** Layouts whose light title has no dark backdrop directly behind it (= invisible title). */
function invisibleTitleLayouts(template: { layouts: LayoutInfo[]; masterBgColor: string }): string[] {
  const masterBgLum = lum(template.masterBgColor);
  const bad: string[] = [];
  for (const layout of template.layouts) {
    const title = layout.placeholders.find((p: PlaceholderInfo) => placeholderRole(p) === "title");
    if (!title) continue; // no title slot → nothing to read
    if (lum(title.style.fontColor) <= LIGHT) continue; // dark/medium title reads fine on a light bg
    const rect = { x: title.style.x, y: title.style.y, w: title.style.w, h: title.style.h };
    const coveredByDarkDeco = layout.decorations.some((d) => lum(d.color) < DARK && coverFraction(rect, d) >= 0.6);
    const bgLum = layout.background ? lum(layout.background) : masterBgLum;
    const fullBleed = !!(layout.backgroundImage || layout.backgroundGradient);
    const backdropDark = coveredByDarkDeco || bgLum < DARK || fullBleed;
    if (!backdropDark) bad.push(layout.name);
  }
  return bad;
}

describe("bundled template title contrast (#274)", () => {
  for (const file of BUNDLED) {
    it(`${file}: every light title has a dark backdrop`, async () => {
      const template = await loadTemplate(readFileSync(resolve(__dirname, "../public/templates/slide", file)));
      expect(invisibleTitleLayouts(template)).toEqual([]);
    });
  }
});
