/**
 * html-export-font-embed-failure.test.tsx — do-no-harm (#194): a subsetting failure (WASM/harfbuzz
 * error, corrupt asset, …) must never break the export. Embedding is strictly additive — on failure
 * the document falls back to the pre-#194 fallback-stack-only rendering, still valid and complete.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("../src/components/font-subsetter", () => ({
  subsetFontToTtf: vi.fn(async () => {
    throw new Error("simulated harfbuzz failure");
  }),
}));

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
      return new Response(readFileSync(resolve(PUBLIC_DIR, "." + url)), { status: 200 });
    }
    return realFetch(input);
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("HTML export: subset-embedding failure is do-no-harm", () => {
  it("still produces a complete, valid document with the deck's text when subsetting always fails", async () => {
    const tpl: TemplateData = await loadTemplate(readFileSync(CANON));
    const deck = parseMd("# 四半期レビュー\n\n- 売上は前年比120%\n- 新規顧客が32社増加");

    const html = await renderDeckToHtml(deck, tpl, { title: "四半期レビュー" });

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("四半期レビュー");
    expect(html).toContain("売上は前年比120%");
    expect(html).not.toContain("@font-face"); // no successful subset → nothing embedded
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:/); // still self-contained
  });
});
