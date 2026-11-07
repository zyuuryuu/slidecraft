/**
 * cjk-class-agreement.test.tsx — #573 (R8 agreement): the CJK font class (gothic / mincho) of a
 * template's title / body text is ONE computation — resolve the theme token (`+mj-lt` / `+mn-lt`,
 * kept raw in TemplateData by the loader contract, #532) → classifyCjkFont — shared by all three
 * consumers:
 *   1. the preview painter (SlideCard's per-element font-family fallback chain),
 *   2. the HTML export's embedded @font-face subsets (deck-html-export),
 *   3. the MCP raster's embedded @font-face (slide-raster / get_slide_image).
 * Before the fix, 2 and 3 classified the RAW token → always "gothic", so a Mincho template (the
 * magazine fixture: theme major = Yu Mincho) asked for "Noto Serif CJK JP" in its CSS but only ever
 * embedded the Sans subset.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderDeckToHtml } from "../src/components/deck-html-export";
import { renderSlideHtml } from "../src/mcp/slide-raster";
import { createSession, newProject } from "../src/mcp/session";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";
import { embedFallbackFamily, type CjkClass } from "../src/engine/font-stack";
import { cjkClassForStyle, cjkClassesForTemplate } from "../src/engine/cjk-class";

const FIXTURES = resolve(__dirname, "fixtures/templates");
const PUBLIC_DIR = resolve(__dirname, "../public");
const MD = "# 四半期経営レビュー\n> 経営企画部\n\n---\n\n# 現状分析\n\n- 売上は前年比120%\n- 新規顧客が32社増加";

/** Expected class per fixture, from each theme's fontScheme (measured 2026-11-07, Issue #573). */
const CASES: { file: string; title: CjkClass; body: CjkClass }[] = [
  { file: "Midnight_Executive_30_TemplateOnly.pptx", title: "gothic", body: "gothic" }, // Georgia / Calibri
  { file: "配布資料_公文書高密度_全レイアウト見本.pptx", title: "gothic", body: "gothic" }, // MS PGothic
  { file: "ビジュアルデッキ_マガジン_全レイアウト見本.pptx", title: "mincho", body: "gothic" }, // Yu Mincho / Yu Gothic
  { file: "技術報告_スタンダード水色_全レイアウト見本.pptx", title: "gothic", body: "gothic" }, // Yu Gothic
];

const realFetch = globalThis.fetch;
beforeAll(() => {
  // Serve public/fonts off disk for the HTML export's subsetter (no dev server under vitest).
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/fonts/")) return new Response(readFileSync(resolve(PUBLIC_DIR, "." + url)), { status: 200 });
    return realFetch(input);
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

/** Families declared by the embedded @font-face rules. */
function embeddedFamilies(html: string): Set<string> {
  return new Set([...html.matchAll(/@font-face\{font-family:"([^"]+)"/g)].map((m) => m[1]!));
}

/** Embed-target families (Noto Sans/Serif CJK JP) that the painter's inline font-family chains ask for. */
function requestedEmbedFamilies(html: string): Set<string> {
  const targets = [embedFallbackFamily("gothic"), embedFallbackFamily("mincho")];
  const out = new Set<string>();
  for (const m of html.matchAll(/font-family:([^;"]*(?:&quot;[^;"]*)*)/g)) {
    const value = m[1]!.replace(/&quot;/g, '"');
    for (const t of targets) if (value.includes(`"${t}"`)) out.add(t);
  }
  return out;
}

describe.each(CASES)("#573 CJK class agreement — $file", ({ file, title, body }) => {
  let bytes: Uint8Array;
  let tpl: TemplateData;
  const expected = () => new Set([embedFallbackFamily(title), embedFallbackFamily(body)]);

  beforeAll(async () => {
    bytes = new Uint8Array(readFileSync(resolve(FIXTURES, file)));
    tpl = await loadTemplate(bytes);
  });

  it("precondition: master fontName is a raw theme token (loader contract, #532)", () => {
    expect(tpl.masterTitleStyle.fontName).toBe("+mj-lt");
    expect(tpl.masterBodyStyle.fontName).toBe("+mn-lt");
  });

  it("the single entry resolves the token before classifying", () => {
    expect(cjkClassForStyle(tpl.masterTitleStyle, tpl.themeFonts)).toBe(title);
    expect(cjkClassForStyle(tpl.masterBodyStyle, tpl.themeFonts)).toBe(body);
    expect(cjkClassesForTemplate(tpl)).toEqual(new Set([title, body]));
  });

  it("HTML export embeds exactly the classes' subsets, and covers every family the painter requests", async () => {
    const html = await renderDeckToHtml(parseMd(MD), tpl, { title: "t" });
    const embedded = embeddedFamilies(html);
    expect(embedded).toEqual(expected());
    for (const f of requestedEmbedFamilies(html)) expect(embedded).toContain(f);
  }, 60_000);

  it("MCP raster embeds exactly the classes' faces, and covers every family the painter requests", async () => {
    const s = createSession(null);
    await newProject(s, bytes, MD);
    for (const i of [0, 1]) {
      const html = renderSlideHtml(s, i);
      const embedded = embeddedFamilies(html);
      expect(embedded).toEqual(expected());
      for (const f of requestedEmbedFamilies(html)) expect(embedded).toContain(f);
    }
  });
});
