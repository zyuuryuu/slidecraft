/**
 * batch-warn.test.ts — Wave 5 of the adversarial-hunt fixes (#6): a free-form batch edit may
 * legitimately change facts or language, so we do NOT reject it — but it must not be SILENT. A
 * fact/language change is surfaced as a warning on the RefineChange (per ADR-0012: 棄却しない・沈黙しない).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { batchEditDeck } from "../src/engine/refine";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";

let catalog: LayoutCatalog;
beforeAll(async () => {
  const tpl = await loadTemplate(readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")));
  catalog = buildCatalog(tpl);
});

const DECK = "# 表紙\n\n---\n\n# 実績\n\n- トークン数は52692、削減率は25%";

describe("batchEditDeck surfaces fact/language changes as warnings (not rejection)", () => {
  it("warns when a numeric fact is dropped, but still applies the edit", async () => {
    const aiFix = async () => ({ ok: true as const, markdown: "# 実績\n\n- トークン数は約5万、削減は大幅" });
    const r = await batchEditDeck(parseMd(DECK), catalog, { indices: [1], instruction: "経営層向けに", aiFix });
    expect(r.changes).toHaveLength(1); // applied (free-form is not rejected)
    const warn = r.changes[0].warnings ?? [];
    expect(warn.some((w) => w.includes("数値"))).toBe(true); // the fact change is surfaced
  });

  it("warns on a JA→EN language flip", async () => {
    const aiFix = async () => ({ ok: true as const, markdown: "# Results\n\n- 52692 tokens, 25% reduction" });
    const r = await batchEditDeck(parseMd(DECK), catalog, { indices: [1], instruction: "英語にして", aiFix });
    expect(r.changes).toHaveLength(1);
    expect((r.changes[0].warnings ?? []).some((w) => w.includes("英語") || w.includes("言語"))).toBe(true);
  });

  it("no warning for a faithful same-language rephrase", async () => {
    const aiFix = async () => ({ ok: true as const, markdown: "# 実績\n\n- トークン52692・削減25%" });
    const r = await batchEditDeck(parseMd(DECK), catalog, { indices: [1], instruction: "簡潔に", aiFix });
    expect(r.changes[0].warnings ?? []).toHaveLength(0);
  });
});
