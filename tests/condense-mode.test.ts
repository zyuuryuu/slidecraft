/**
 * condense-mode.test.ts — the harness refine RESIDUE uses the Markdown-ONLY sub-prompt
 * (roadmap #2 P1b): so a small in-app model can't mis-pick the dual-mode design-ops format.
 * The freeform batch edit keeps the dual-mode "slide" prompt.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { systemPromptForMode } from "../src/engine/llm-prompts";
import { slideCondensePrompt, slideMarkdownEditPrompt } from "../src/engine/deck-plan-prompts";
import { refineDeck, batchEditDeck } from "../src/engine/refine";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";

describe("condense mode wiring", () => {
  it("systemPromptForMode('condense') is the Markdown-only condense prompt; 'slide' is unchanged", () => {
    expect(systemPromptForMode("condense", "2026-01-01")).toBe(slideCondensePrompt());
    expect(systemPromptForMode("slide", "2026-01-01")).toBe(slideMarkdownEditPrompt());
  });

  let catalog: LayoutCatalog;
  beforeAll(async () => {
    catalog = buildCatalog(await loadTemplate(readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx"))));
  });

  it("refineDeck hands the aiFix kind 'condense' (→ Markdown-only prompt)", async () => {
    const kinds: string[] = [];
    const deck = parseMd("# 表紙\n\n---\n\n# 背景\n\n- これは非常に長い文章のままの箇条書きで、キーフレーズになっておらず読みにくい悪い例です");
    await refineDeck(deck, catalog, {
      level: 3,
      aiFix: async (_r, meta) => { kinds.push(meta.kind); return { ok: true as const, markdown: "# 背景\n\n- 短い要約" }; },
    });
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === "condense")).toBe(true);
  });

  it("batchEditDeck hands the aiFix kind 'edit' (→ dual-mode prompt kept)", async () => {
    const kinds: string[] = [];
    const deck = parseMd("# 表紙\n\n---\n\n# A\n\n- 元のA");
    await batchEditDeck(deck, catalog, {
      indices: [1],
      instruction: "簡潔に",
      aiFix: async (_r, meta) => { kinds.push(meta.kind); return { ok: true as const, markdown: "# A\n\n- 編集後" }; },
    });
    expect(kinds).toEqual(["edit"]);
  });
});
