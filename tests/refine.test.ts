/**
 * refine.test.ts — the closed-loop refiner (stage C / distill Lv3): diagnose →
 * deterministic levers → AI residue → re-diagnose → converge. AI is injected (mock).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { refineDeck, batchEditDeck } from "../src/engine/refine";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";

let catalog: LayoutCatalog;
beforeAll(async () => {
  const tpl = await loadTemplate(readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")));
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
    const r = await refineDeck(parseMd(KV_DECK), catalog, { level: 2, aiFix: async () => { aiCalls++; return { ok: true, markdown: "" }; } });
    expect(aiCalls).toBe(0); // deterministic only
    expect(r.changes.some((c) => c.lever === "visualize" && c.kind === "deterministic")).toBe(true);
    expect(r.deck.slides.find((s) => s.table)?.table?.rows[0]).toEqual(["項目", "内容"]);
    expect(r.converged).toBe(true); // table resolves the visualize issue
  });

  it("Lv3 = AI residue: condenses a long bullet via the injected aiFix, then converges", async () => {
    let seenRequest = "";
    const aiFix = async (request: string) => {
      seenRequest = request;
      return { ok: true as const, markdown: "# 背景\n\n- 旧CRMは遅くモバイル非対応" }; // a short, condensed slide
    };
    const r = await refineDeck(parseMd(LONG_DECK), catalog, { level: 3, aiFix });
    expect(seenRequest).toContain("Current slide:"); // the slide-fix contract was sent
    expect(r.changes.some((c) => c.lever === "condense" && c.kind === "ai")).toBe(true);
    expect(r.converged).toBe(true);
  });

  it("success that doesn't converge is settled (one attempt, no retry spam)", async () => {
    let calls = 0;
    // Returns ok but STILL too long → the slide stays flagged. Must not re-submit (the
    // cancel/retry-spam bug). Success ≠ failure, so no retry.
    const r = await refineDeck(parseMd(LONG_DECK), catalog, {
      level: 3, maxIterations: 8,
      aiFix: async () => { calls++; return { ok: true, markdown: "# 背景\n\n- まだ全く要約されていない非常に長い文章のままの箇条書きが返る悪い例です" }; },
    });
    expect(calls).toBe(1); // one attempt for the one flagged slide
    expect(r.converged).toBe(false);
  });

  it("best-of-N picks the clean candidate over a HARD-violating one (ADR-0019 Option B, whole-deck)", async () => {
    // candidate 0 drops the title (structure loss = HARD under 'condense'); candidate 1 keeps it (clean).
    const seen: number[] = [];
    const aiFix = async (_req: string, meta: { candidate?: number }) => {
      seen.push(meta.candidate ?? -1);
      return meta.candidate === 0
        ? { ok: true as const, markdown: "- 旧CRMは遅い" }           // no title → HARD → rejected
        : { ok: true as const, markdown: "# 背景\n\n- 旧CRMは遅い" }; // title kept → clean → applied
    };
    // N=1 only ever sees candidate 0 (HARD) → rejected every attempt → never applies / doesn't converge.
    const one = await refineDeck(parseMd(LONG_DECK), catalog, { level: 3, aiFix, bestOfN: 1 });
    expect(one.changes.some((c) => c.kind === "ai")).toBe(false);
    expect(one.converged).toBe(false);
    // N=2 also generates candidate 1 (clean) → the loop's verdict scoring picks it → applies → converges.
    seen.length = 0;
    const two = await refineDeck(parseMd(LONG_DECK), catalog, { level: 3, aiFix, bestOfN: 2 });
    expect(seen).toContain(0);
    expect(seen).toContain(1); // fanned out N candidates
    expect(two.changes.find((c) => c.kind === "ai")?.afterMd).toContain("# 背景"); // the CLEAN one won
    expect(two.converged).toBe(true);
  });

  it("a retryable failure is retried up to the cap, then settles (bounded)", async () => {
    let calls = 0;
    const r = await refineDeck(parseMd(LONG_DECK), catalog, {
      level: 3, maxIterations: 10, maxAiRetries: 2,
      aiFix: async () => { calls++; return { ok: false, cancelled: false, retryable: true, message: "timeout" }; },
    });
    expect(calls).toBe(3); // 1 try + 2 retries — not infinite
    expect(r.converged).toBe(false);
  });

  it("a cancelled outcome is never retried", async () => {
    let calls = 0;
    const r = await refineDeck(parseMd(LONG_DECK), catalog, {
      level: 3, maxIterations: 10, maxAiRetries: 2,
      aiFix: async () => { calls++; return { ok: false, cancelled: true }; },
    });
    expect(calls).toBe(1); // cancel → settled immediately
    expect(r.changes).toHaveLength(0);
  });

  it("a non-retryable failure is not retried", async () => {
    let calls = 0;
    await refineDeck(parseMd(LONG_DECK), catalog, {
      level: 3, maxIterations: 10, maxAiRetries: 2,
      aiFix: async () => { calls++; return { ok: false, cancelled: false, retryable: false, message: "invalid api key" }; },
    });
    expect(calls).toBe(1); // permanent error → no retry
  });

  it("deterministic-first: a key-value slide is fixed without the AI even at Lv3", async () => {
    let aiCalls = 0;
    const r = await refineDeck(parseMd(KV_DECK), catalog, { level: 3, aiFix: async () => { aiCalls++; return { ok: true, markdown: "" }; } });
    expect(aiCalls).toBe(0); // visualize handled it deterministically; AI never needed
    expect(diagnoseDeck(r.deck, catalog)).toHaveLength(0);
  });
});

describe("batchEditDeck (multi-select)", () => {
  const DECK = "# 表紙\n\n---\n\n# A\n\n- 元のA\n\n---\n\n# B\n\n- 元のB";

  it("applies one instruction to each selected slide, collecting before→after changes", async () => {
    let calls = 0;
    const aiFix = async (_req: string, meta: { slideIndex: number }) => {
      calls++;
      return { ok: true as const, markdown: `# 編集${meta.slideIndex}\n\n- 簡潔化された内容` };
    };
    const r = await batchEditDeck(parseMd(DECK), catalog, { indices: [1, 2], instruction: "簡潔に", aiFix });
    expect(calls).toBe(2); // one AI call per selected slide
    expect(r.changes.map((c) => c.slideIndex)).toEqual([1, 2]);
    expect(r.changes.every((c) => c.lever === "edit" && c.kind === "ai")).toBe(true);
  });

  it("best-of-N picks the candidate that keeps numbers (fewest fact drift) — free-form scoring", async () => {
    const NUM_DECK = "# 表紙\n\n---\n\n# 売上\n\n- 売上は100万円で好調";
    const seen: number[] = [];
    const aiFix = async (_req: string, meta: { candidate?: number }) => {
      seen.push(meta.candidate ?? -1);
      return meta.candidate === 0
        ? { ok: true as const, markdown: "# 売上\n\n- 好調" }           // dropped 100 → fact drift
        : { ok: true as const, markdown: "# 売上\n\n- 100万円で好調" }; // kept 100 → no fact drift
    };
    const r = await batchEditDeck(parseMd(NUM_DECK), catalog, { indices: [1], instruction: "簡潔に", aiFix, bestOfN: 2 });
    expect(seen).toContain(0);
    expect(seen).toContain(1); // fanned out N candidates for the one slide
    expect(r.changes[0]?.afterMd).toContain("100"); // the number-keeping candidate was chosen
  });

  it("skips a slide whose AI is cancelled/fails — not fatal", async () => {
    const aiFix = async (_req: string, meta: { slideIndex: number }) =>
      meta.slideIndex === 1
        ? { ok: false as const, cancelled: true as const }
        : { ok: true as const, markdown: "# B2\n\n- 編集後" };
    const r = await batchEditDeck(parseMd(DECK), catalog, { indices: [1, 2], instruction: "x", aiFix });
    expect(r.changes.map((c) => c.slideIndex)).toEqual([2]); // slide 1 skipped, slide 2 applied
  });
});
