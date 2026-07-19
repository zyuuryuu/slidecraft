/**
 * html-export-font-embed-integration.test.tsx — S3 end-to-end: renderDeckToHtml wires
 * collectDeckText → resolveFontSubsetSource → subsetFontToWoff2 into the exported HTML's
 * @font-face (#194, final wiring stage of #115). Default ON (no opt-in toggle — issue #194).
 *
 * `fetch` is stubbed to serve public/fonts/*.ttf straight off disk (no dev server runs under
 * vitest); this is test-only plumbing, production `fetch("/fonts/...")` hits the real static asset.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderDeckToHtml } from "../src/components/deck-html-export";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";

const CANON = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const PUBLIC_DIR = resolve(__dirname, "../public");

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/fonts/")) {
      const bytes = readFileSync(resolve(PUBLIC_DIR, "." + url));
      return new Response(bytes, { status: 200 });
    }
    return realFetch(input);
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("HTML export: CJK font-face embedding is wired end-to-end (default ON)", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(CANON));
  });

  it("embeds a data:font/woff2 @font-face for a CJK-containing deck", async () => {
    const deck = parseMd("# 四半期レビュー\n\n- 売上は前年比120%\n- 新規顧客が32社増加");
    const html = await renderDeckToHtml(deck, tpl, { title: "四半期レビュー" });

    expect(html).toContain("@font-face");
    expect(html).toMatch(/src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\)\s*format\("woff2"\)/);
    expect(html).toMatch(/font-weight:400/);
  });

  it("section+toc deck: collected text includes the derived TOC title (materialized deck invariant, #193 handoff)", async () => {
    // Regression guard for the #193→#194 handoff note: collectDeckText must run on the MATERIALIZED
    // deck (materializeDerivedSlides), or the derived TOC slide's title "目次" never reaches the
    // subsetter and would render as tofu once embedding replaces the fallback stack for that glyph.
    const md = `<!-- toc -->

---

<!-- section -->
# 第1章

- はじめに

---

# 本文

- 詳細

---

<!-- section -->
# 第2章

- 詳細2
`;
    const deck = parseMd(md);
    const html = await renderDeckToHtml(deck, tpl, {});

    expect(html).toContain("目次"); // the derived TOC slide's own title, rendered into the SSR'd HTML
    expect(html).toContain("@font-face"); // and the embedding pipeline saw it (materialized deck)
  });

  it("skips embedding entirely for a non-CJK deck (no @font-face, zero size cost)", async () => {
    const deck = parseMd("# Quarterly Review\n\n- Revenue up 12% YoY\n- 32 new enterprise accounts");
    const html = await renderDeckToHtml(deck, tpl, { title: "Quarterly Review" });

    expect(html).not.toContain("@font-face");
    expect(html).not.toContain("font/woff2");
  });

  it("embeds both regular (400) and bold (700) weight subsets when the deck uses bold", async () => {
    // A table's header row renders bold (SlidePreview: isHeader ? 700 : 400) — a natural bold-usage
    // trigger without relying on markdown emphasis syntax mapping to segment.bold.
    const deck = parseMd("# 価格表\n\n| 項目 | 値 |\n|---|---|\n| 単価 | 100円 |");
    const html = await renderDeckToHtml(deck, tpl, {});

    expect(html).toMatch(/font-weight:400/);
    expect(html).toMatch(/font-weight:700/);
    expect((html.match(/@font-face/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
