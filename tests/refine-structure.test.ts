/**
 * refine-structure.test.ts — slice 3 of the AI-quality theme: the structure guard on the two
 * ENGINE apply paths (refineDeck condense + batchEditDeck), complementing the front-facing
 * handleApplySlide wiring.
 *
 * - refineDeck (condense): a condense returns the FULL slide and must not drop the title/figure —
 *   validateStructure('condense') is merged into the fact/language guard so a structure-dropping
 *   candidate is retried, and a clean one is reconciled before apply.
 * - batchEditDeck (free-form): the instruction is arbitrary (it may legitimately change facts or
 *   language), so ONLY structure is reconciled — never a fact/language rejection.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { refineDeck, batchEditDeck } from "../src/engine/refine";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";

let catalog: LayoutCatalog;
beforeAll(async () => {
  const tpl = await loadTemplate(readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")));
  catalog = buildCatalog(tpl);
});

// A slide with a title + a long number-bearing bullet (triggers the condense lever).
const NUM_DECK = "# 表紙\n\n---\n\n# 実績\n\n- 売上高は前年同期比23%増の14億2000万円となり四半期として過去最高を更新する見込みです";

describe("refineDeck — structure guard (condense must keep the title)", () => {
  it("rejects a condense that drops the slide title, retries, keeps original on exhaustion", async () => {
    let calls = 0;
    // Keeps the numbers (fact-clean) but DROPS the "# 実績" title → structure HARD → retried.
    const aiFix = async () => { calls++; return { ok: true as const, markdown: "- 売上高: 23%増、14億2000万円" }; };
    const r = await refineDeck(parseMd(NUM_DECK), catalog, { level: 3, maxAiRetries: 2, aiFix });
    expect(calls).toBe(3); // 1 + 2 retries, bounded
    expect(r.changes).toHaveLength(0); // the title-dropping candidate was never applied
    expect(JSON.stringify(r.deck.slides)).toContain("実績"); // title intact
  });

  it("applies a condense that keeps title + facts (structure guard doesn't block clean edits)", async () => {
    let calls = 0;
    const aiFix = async () => {
      calls++;
      return calls === 1
        ? { ok: true as const, markdown: "- 売上高: 23%増、14億2000万円" } // drops title → rejected
        : { ok: true as const, markdown: "# 実績\n\n- 売上高: 23%増、14億2000万円" }; // keeps title → accepted
    };
    const r = await refineDeck(parseMd(NUM_DECK), catalog, { level: 3, maxAiRetries: 2, aiFix });
    expect(calls).toBe(2);
    const change = r.changes.find((c) => c.lever === "condense");
    expect(change?.afterMd).toContain("14億2000万円");
    expect(JSON.stringify(r.deck.slides)).toContain("実績");
  });
});

describe("batchEditDeck — structure reconcile (free-form: no fact/language rejection)", () => {
  const PINNED = "# 表紙\n\n---\n\n<!-- slide: Content.1Body.Single+1Source -->\n# 見出し\n> 補足\n\n- 要点";

  it("reconciles a dropped layout pin + title from the previous slide", async () => {
    const aiFix = async () => ({ ok: true as const, markdown: "- 短縮した要点" }); // drops header + title
    const r = await batchEditDeck(parseMd(PINNED), catalog, { indices: [1], instruction: "簡潔に", aiFix });
    expect(r.deck.slides[1].layout).toBe("Content.1Body.Single+1Source"); // pin restored
    const title = r.deck.slides[1].placeholders.find((p) => p.idx === "15");
    expect(title?.paragraphs[0].segments[0].text).toBe("見出し"); // title restored
    expect(r.changes).toHaveLength(1); // still applied (the body edit lands)
  });

  it("respects a present title the edit changed (does not overwrite with old)", async () => {
    const aiFix = async () => ({ ok: true as const, markdown: "<!-- slide: Content.1Body.Single+1Source -->\n# 新見出し\n\n- 要点2" });
    const r = await batchEditDeck(parseMd(PINNED), catalog, { indices: [1], instruction: "改題", aiFix });
    const title = r.deck.slides[1].placeholders.find((p) => p.idx === "15");
    expect(title?.paragraphs[0].segments[0].text).toBe("新見出し");
  });

  it("does NOT reject a free-form edit that changes facts/language (batch is not a condense)", async () => {
    const NUMBATCH = "# 表紙\n\n---\n\n# 実績\n\n- 売上は14億2000万円";
    // instruction '英語にして' — a legitimate language change; must be applied, never fact/lang-rejected
    const aiFix = async () => ({ ok: true as const, markdown: "# Results\n\n- Sales grew strongly" });
    const r = await batchEditDeck(parseMd(NUMBATCH), catalog, { indices: [1], instruction: "英語にして", aiFix });
    expect(r.changes).toHaveLength(1); // applied, not rejected
  });
});
