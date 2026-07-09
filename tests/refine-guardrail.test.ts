/**
 * refine-guardrail.test.ts — the validate-and-retry guardrail (roadmap #2 P1):
 * refineDeck must REJECT a fact-corrupting / language-drifting AI candidate and retry,
 * keeping the original on exhaustion rather than applying a bad edit blind.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { refineDeck } from "../src/engine/refine";
import { parseMd } from "../src/engine/md-parser";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";

let catalog: LayoutCatalog;
beforeAll(async () => {
  const tpl = await loadTemplate(readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")));
  catalog = buildCatalog(tpl);
});

// A long sentence-bullet carrying numbers (triggers the condense lever; facts must survive).
const NUM_DECK = "# 表紙\n\n---\n\n# 実績\n\n- 売上高は前年同期比23%増の14億2000万円となり四半期として過去最高を更新する見込みです";

describe("refineDeck — validate-and-retry guardrail", () => {
  it("rejects a fact-dropping candidate, retries, and applies a later clean one", async () => {
    let calls = 0;
    const aiFix = async () => {
      calls++;
      return calls === 1
        ? { ok: true as const, markdown: "# 実績\n\n- 売上高: 23%増、過去最高" } // DROPS 14億2000万 → rejected
        : { ok: true as const, markdown: "# 実績\n\n- 売上高: 23%増、14億2000万円（過去最高）" }; // clean
    };
    const r = await refineDeck(parseMd(NUM_DECK), catalog, { level: 3, maxAiRetries: 2, aiFix });
    expect(calls).toBe(2); // attempt 1 rejected by the guardrail, attempt 2 accepted
    const change = r.changes.find((c) => c.lever === "condense");
    expect(change?.afterMd).toContain("14億2000万円"); // the clean candidate won, fact intact
  });

  it("keeps the original when every candidate corrupts a fact (never applies a bad edit)", async () => {
    let calls = 0;
    const aiFix = async () => {
      calls++;
      return { ok: true as const, markdown: "# 実績\n\n- 売上高: 23%増、過去最高" }; // always drops 14億2000万
    };
    const r = await refineDeck(parseMd(NUM_DECK), catalog, { level: 3, maxAiRetries: 2, aiFix });
    expect(calls).toBe(3); // 1 try + 2 retries, bounded
    expect(r.changes).toHaveLength(0); // nothing applied — the fact-dropping edit was never committed
    // the original facts are still on the slide (not silently mangled)
    const bodyText = JSON.stringify(r.deck.slides);
    expect(bodyText).toContain("14億2000万円");
  });

  it("rejects a language-drift candidate (JA → 中文) the same way", async () => {
    let calls = 0;
    const aiFix = async () => {
      calls++;
      return calls === 1
        ? { ok: true as const, markdown: "# 实绩\n\n- 销售额23%增长，14亿2000万日元" } // drifted to 中文 → rejected
        : { ok: true as const, markdown: "# 実績\n\n- 売上高: 23%増 14億2000万円" }; // clean JA (no 読点 — slide-clean)
    };
    const r = await refineDeck(parseMd(NUM_DECK), catalog, { level: 3, maxAiRetries: 2, aiFix });
    expect(calls).toBe(2); // the 中文 candidate was rejected, retried
    expect(diagnoseDeck(r.deck, catalog).filter((d) => d.slideIndex === 1)).toHaveLength(0); // converged on the clean one
  });
});
