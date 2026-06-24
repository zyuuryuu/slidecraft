/**
 * refine.test.ts — the closed-loop refiner (stage C / distill Lv3): diagnose →
 * deterministic levers → AI residue → re-diagnose → converge. AI is injected (mock).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { refineDeck } from "../src/engine/refine";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";

let catalog: LayoutCatalog;
beforeAll(async () => {
  const tpl = await loadTemplate(readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx")));
  catalog = buildCatalog(tpl);
});

// A spec slide (idx 1, after a title) whose body is a clean key-value list.
const KV_DECK = "# 表紙\n\n---\n\n# 仕様\n\n- 速度: 0.8秒\n- 重量: 1.2kg\n- 料金: 1200円";
// A slide whose bullet is a long sentence (condense lever).
const LONG_DECK = "# 表紙\n\n---\n\n# 背景\n\n- これは非常に長い文章のままの箇条書きで、キーフレーズになっておらず読みにくい悪い例です";

describe("refineDeck", () => {
  it("Lv1 = diagnose only: never transforms, reports convergence", async () => {
    const r = await refineDeck(parseMd(KV_DECK), catalog, { level: 1 });
    expect(r.changes).toHaveLength(0); // flagged, not fixed
    expect(r.converged).toBe(false); // the key-value issue remains
  });

  it("Lv2 = deterministic: key-value slide → native table, no AI called", async () => {
    let aiCalls = 0;
    const r = await refineDeck(parseMd(KV_DECK), catalog, { level: 2, aiFix: async (x) => { aiCalls++; return x; } });
    expect(aiCalls).toBe(0); // deterministic only
    expect(r.changes.some((c) => c.lever === "visualize" && c.kind === "deterministic")).toBe(true);
    expect(r.deck.slides.find((s) => s.table)?.table?.rows[0]).toEqual(["項目", "内容"]);
    expect(r.converged).toBe(true); // table resolves the visualize issue
  });

  it("Lv3 = AI residue: condenses a long bullet via the injected aiFix, then converges", async () => {
    let seenRequest = "";
    const aiFix = async (request: string) => {
      seenRequest = request;
      return "# 背景\n\n- 旧CRMは遅くモバイル非対応"; // a short, condensed slide
    };
    const r = await refineDeck(parseMd(LONG_DECK), catalog, { level: 3, aiFix });
    expect(seenRequest).toContain("Current slide:"); // the slide-fix contract was sent
    expect(r.changes.some((c) => c.lever === "condense" && c.kind === "ai")).toBe(true);
    expect(r.converged).toBe(true);
  });

  it("attempts each slide's AI at most once per run (no retry spam when it doesn't converge)", async () => {
    let calls = 0;
    // Returns a result that is STILL too long → the slide stays flagged. Without the
    // once-per-run guard the loop would re-submit it every pass (the cancel-spam bug).
    const aiFix = async () => {
      calls++;
      return "# 背景\n\n- まだ全く要約されていない非常に長い文章のままの箇条書きが返ってくる悪い例です";
    };
    const r = await refineDeck(parseMd(LONG_DECK), catalog, { level: 3, aiFix, maxIterations: 5 });
    expect(calls).toBe(1); // one attempt for the one flagged slide — not 5
    expect(r.converged).toBe(false);
  });

  it("does not spin: a no-op aiFix stops the loop (no infinite iterations)", async () => {
    const r = await refineDeck(parseMd(LONG_DECK), catalog, { level: 3, aiFix: async () => "", maxIterations: 10 });
    expect(r.changes).toHaveLength(0); // empty AI result → no change applied
    expect(r.iterations).toBeLessThanOrEqual(2); // bailed early on no-progress
    expect(r.converged).toBe(false);
  });

  it("deterministic-first: a key-value slide is fixed without the AI even at Lv3", async () => {
    let aiCalls = 0;
    const r = await refineDeck(parseMd(KV_DECK), catalog, { level: 3, aiFix: async (x) => { aiCalls++; return x; } });
    expect(aiCalls).toBe(0); // visualize handled it deterministically; AI never needed
    expect(diagnoseDeck(r.deck, catalog)).toHaveLength(0);
  });
});
