/**
 * issue-153-closing-body.test.ts — #153: a closing slide (title matches CLOSING_RE) that ALSO
 * carries body content (bullets) used to route to `Closing.1Message.Single` (ctrTitle, no body
 * placeholder) and silently drop the body. Fix (ADR-0030 層2・選択側): when the closing slide has
 * body content, prefer a closing layout that can actually hold it (`Closing.1Steps.Single+1Notes`);
 * degrade to `content` only if no such closing layout exists. A title-only closing slide (no body)
 * must keep resolving to `Closing.1Message.Single`, byte-identical (絶対不変条件).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { distillDeck } from "../src/engine/distill";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import * as S from "../src/mcp/session";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

// Issue #153 repro: a cover slide followed by a closing slide whose title matches CLOSING_RE
// ("まとめ") AND carries a bullet body.
const REPRO_MD = "# 表紙\n\n---\n\n# まとめ\n\n- ありがとうございました";

const isUnbound = (m: string) => m.includes("未束縛");

describe("issue #153 — closing slide with body content", () => {
  it("autoSelectLayout routes a body-carrying closing slide to the body-bearing closing layout", async () => {
    const tpl: TemplateData = await loadTemplate(readFileSync(MIDNIGHT));
    const catalog = buildCatalog(tpl);
    const deck = parseMd(REPRO_MD);
    const closingSlide = deck.slides[1];
    const name = autoSelectLayout(closingSlide, 1, deck.slides.length, catalog);
    expect(name).toBe("Closing.1Steps.Single+1Notes");
  });

  it("the bullet content survives the round-trip (not silently dropped)", async () => {
    const s = S.createSession();
    await S.newProject(s, readFileSync(MIDNIGHT), REPRO_MD);
    const out = S.getDeckMarkdown(s);
    expect(out).toContain("ありがとうございました");
  });

  it("no #145 unbound warning is raised for the closing slide", async () => {
    const tpl: TemplateData = await loadTemplate(readFileSync(MIDNIGHT));
    const catalog = buildCatalog(tpl);
    const deck = distillDeck(parseMd(REPRO_MD), catalog);
    const issues = diagnoseDeck(deck, catalog, tpl.layouts);
    expect(issues.some((x) => x.slideIndex === 1 && isUnbound(x.message))).toBe(false);
  });

  it("invariant: a title-only closing slide (no body) still resolves byte-identical to Closing.1Message.Single", async () => {
    const tpl: TemplateData = await loadTemplate(readFileSync(MIDNIGHT));
    const catalog = buildCatalog(tpl);
    const titleOnly = "# 表紙\n\n---\n\n# ご清聴ありがとうございました";
    const deck = parseMd(titleOnly);
    const closingSlide = deck.slides[1];
    const name = autoSelectLayout(closingSlide, 1, deck.slides.length, catalog);
    expect(name).toBe("Closing.1Message.Single");
    expect(autoSelectLayout(closingSlide, 1, deck.slides.length)).toBe("Closing.1Message.Single"); // no-catalog fallback parity
  });
});
