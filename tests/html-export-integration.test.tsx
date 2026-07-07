/**
 * html-export-integration.test.tsx — S3 end-to-end: a whole deck → one openable,
 * self-contained HTML document via the orchestrator (SSR SlideCard + shell). Proves
 * the pipeline renders text, native diagrams and multiple slides into a single file
 * with no external references. Set HTML_EXPORT_SAMPLE=/path.html to also emit a copy.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { renderDeckToHtml } from "../src/components/deck-html-export";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";

const CANON = resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx");

const DECK_MD = [
  "# 四半期レビュー\n> Q4 Review\n\n- 売上は前年比120%\n- 新規顧客が32社増加",
  "# システム構成図\n\n```diagram\ntype: flowchart\ndirection: TB\ntitle: CRM\nnodes:\n" +
    "  - id: client\n    label: ブラウザ\n  - id: api\n    label: API Gateway\n" +
    "edges:\n  - from: client\n    to: api\n```",
  "# まとめ\n\n- 継続成長\n- 次期投資判断",
].join("\n\n---\n\n");

describe("HTML export S3: end-to-end orchestrator", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(CANON));
  });

  it("renders a whole deck to one openable, self-contained HTML document", async () => {
    const deck = parseMd(DECK_MD);
    const html = await renderDeckToHtml(deck, tpl, { title: "四半期レビュー" });

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect((html.match(/<section class="slide/g) ?? []).length).toBe(deck.slides.length);
    expect(html).toContain("四半期レビュー");
    expect(html).toContain("売上は前年比120%");
    expect(html).toContain("<svg"); // native diagram embedded inline
    expect(html).toContain("ブラウザ"); // diagram node label
    expect(html).toContain("まとめ");
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:/); // no external resources

    const out = process.env.HTML_EXPORT_SAMPLE;
    if (out) writeFileSync(out, html);
  });

  it("threads the chosen transition through to the exported document", async () => {
    const html = await renderDeckToHtml(parseMd("# A\n\n- x"), tpl, { transition: "push" });
    expect(html).toMatch(/<html[^>]*data-transition="push"/);
  });

  it("ALWAYS locks the exported document under a CSP (M6 — the export path never ships nonce-less)", async () => {
    const html = await renderDeckToHtml(parseMd("# A\n\n- x"), tpl, {});
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy"[^>]*default-src 'none'/);
    expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9+/]+'/); // scripts only via the per-export nonce
  });
});
