/**
 * refine-ops.test.ts — #106 P4: the batch edit (batchEditDeck) and the refine loop's AI condense
 * (refineDeck Lv3) accept an ops reply through the same router as the AI panel (routeSlideEdit), and
 * report which route each AI change took (RefineResult.routes).
 *   (a) batch: setField / setCell / figure ops change only their target; skips surface as warnings;
 *       a malformed array falls back to the Markdown path with a notice.
 *   (c) refine Lv3: a setField reply is scored and adopted (Markdown replies: see refine.test.ts).
 *   (d) routes: one record per AI outcome with the route and the skipped-op count.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { refineDeck, batchEditDeck, type AiSlideFix } from "../src/engine/refine";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { paragraphsToText } from "../src/engine/field-text";
import type { SlideIR } from "../src/engine/slide-schema";

let catalog: LayoutCatalog;
beforeAll(async () => {
  const tpl = await loadTemplate(readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")));
  catalog = buildCatalog(tpl);
});

const fixed = (reply: string): AiSlideFix => async () => ({ ok: true, markdown: reply });
const bodyIdx = (s: SlideIR) => s.placeholders.find((p) => p.idx !== "0" && p.idx !== "15")!.idx;
const textOf = (s: SlideIR, idx: string) => paragraphsToText(s.placeholders.find((p) => p.idx === idx)!.paragraphs);

const TEXT_DECK = "# 表紙\n\n---\n\n# 実績\n\n- 売上は 120 億円\n- 利益は 30 億円\n\n---\n\n# 次\n\n- 来期の計画";
const TABLE_DECK = "# 表紙\n\n---\n\n# 表\n\n| 項目 | 値 |\n| --- | --- |\n| 売上 | 100 |\n| 利益 | 20 |";
const FIG_DECK = "# 表紙\n\n---\n\n# 図\n\n```diagram\ntype: flowchart\nnodes:\n  - id: a\n    label: 受付\n  - id: b\n    label: 処理\nedges:\n  - from: a\n    to: b\n```";

describe("(a) batchEditDeck applies ops replies through routeSlideEdit", () => {
  it("setField rewrites only the named placeholder; other slides and fields stay byte-identical", async () => {
    const deck = parseMd(TEXT_DECK);
    const idx = bodyIdx(deck.slides[1]);
    const r = await batchEditDeck(deck, catalog, {
      indices: [1], instruction: "利益の行を消して",
      aiFix: fixed(JSON.stringify([{ op: "setField", idx, text: "売上は 120 億円" }])),
    });
    expect(r.changes).toHaveLength(1);
    expect(textOf(r.deck.slides[1], idx)).toBe("売上は 120 億円");
    const others = r.deck.slides[1].placeholders.filter((p) => p.idx !== idx);
    expect(others).toEqual(deck.slides[1].placeholders.filter((p) => p.idx !== idx));
    expect(r.deck.slides[0]).toBe(deck.slides[0]);
    expect(r.deck.slides[2]).toBe(deck.slides[2]);
    expect(r.changes[0].afterMd).toContain("売上は 120 億円");
    expect(r.changes[0].afterMd).not.toContain("利益");
  });

  it("setCell changes one table cell; the rest of the table is unchanged", async () => {
    const deck = parseMd(TABLE_DECK);
    const r = await batchEditDeck(deck, catalog, {
      indices: [1], instruction: "売上を 120 に",
      aiFix: fixed(JSON.stringify([{ op: "setCell", row: 1, col: 1, text: "120" }])),
    });
    expect(r.changes).toHaveLength(1);
    const want = deck.slides[1].table!.rows.map((row) => [...row]);
    want[1][1] = "120";
    expect(r.deck.slides[1].table!.rows).toEqual(want);
    expect(r.deck.slides[1].placeholders).toEqual(deck.slides[1].placeholders);
  });

  it("figure ops relabel one node; skipped ops are surfaced as warnings (never silent)", async () => {
    const deck = parseMd(FIG_DECK);
    const r = await batchEditDeck(deck, catalog, {
      indices: [1], instruction: "受付を窓口に",
      aiFix: fixed(JSON.stringify([{ op: "nodeUpdate", id: "a", label: "窓口" }, { op: "nodeUpdate", id: "zz", label: "X" }])),
    });
    expect(r.changes).toHaveLength(1);
    const yaml = r.deck.slides[1].diagram!.yaml;
    expect(yaml).toContain("窓口");
    expect(yaml).toContain("処理");
    expect(yaml).not.toContain("受付");
    expect((r.changes[0].warnings ?? []).some((w) => w.includes("zz"))).toBe(true);
  });

  it("a malformed setField array falls back to the Markdown path and the fallback is announced", async () => {
    const deck = parseMd(TEXT_DECK);
    const r = await batchEditDeck(deck, catalog, {
      indices: [1], instruction: "x",
      aiFix: fixed(JSON.stringify([{ op: "setField", idx: bodyIdx(deck.slides[1]) }])), // text missing
    });
    const warnings = r.changes.flatMap((c) => c.warnings ?? []);
    const recorded = r.routes ?? [];
    expect(recorded.map((x) => x.route)).toContain("fallback");
    expect([...warnings, ...recorded.flatMap((x) => x.notices ?? [])].some((w) => w.includes("[opsフォールバック]"))).toBe(true);
  });

  it("an ops reply whose ops all miss leaves the slide unchanged and still reports the skips", async () => {
    const deck = parseMd(TEXT_DECK);
    const r = await batchEditDeck(deck, catalog, {
      indices: [1], instruction: "x",
      aiFix: fixed(JSON.stringify([{ op: "setField", idx: "99", text: "y" }])),
    });
    expect(r.changes).toHaveLength(0);
    expect(r.deck.slides[1]).toBe(deck.slides[1]);
    expect(r.routes).toEqual([
      { slideIndex: 1, route: "field-ops", skipped: 1, applied: false, notices: [expect.stringContaining('"99"')] },
    ]);
  });
});

// A slide whose bullet is a long sentence (condense lever) — same as refine.test.ts LONG_DECK.
const LONG_DECK = "# 表紙\n\n---\n\n# 背景\n\n- これは非常に長い文章のままの箇条書きで、キーフレーズになっておらず読みにくい悪い例です";

describe("(c) refineDeck Lv3 accepts a setField condense reply", () => {
  it("scores and adopts the merged slide, then converges", async () => {
    const deck = parseMd(LONG_DECK);
    const idx = bodyIdx(deck.slides[1]);
    const r = await refineDeck(deck, catalog, { level: 3, aiFix: fixed(JSON.stringify([{ op: "setField", idx, text: "長文の箇条書きは読みにくい" }])) });
    expect(r.changes.some((c) => c.lever === "condense" && c.kind === "ai")).toBe(true);
    expect(textOf(r.deck.slides[1], idx)).toBe("長文の箇条書きは読みにくい");
    expect(r.deck.slides[1].layout).toBe(deck.slides[1].layout); // structure kept by the merge itself
    expect(r.converged).toBe(true);
  });

  it("Lv1 / Lv2 results carry no routes (no AI ran — result shape unchanged)", async () => {
    const deck = parseMd(LONG_DECK);
    expect("routes" in (await refineDeck(deck, catalog, { level: 1 }))).toBe(false);
    expect("routes" in (await refineDeck(deck, catalog, { level: 2 }))).toBe(false);
  });
});

describe("(d) RefineResult.routes records the route and skipped count per AI outcome", () => {
  it("batch: markdown / field-ops / data-ops are told apart", async () => {
    const deck = parseMd(`${TEXT_DECK}\n\n---\n\n# 表\n\n| 項目 | 値 |\n| --- | --- |\n| 売上 | 100 |`);
    const idx = bodyIdx(deck.slides[1]);
    const replies: Record<number, string> = {
      1: JSON.stringify([{ op: "setField", idx, text: "売上は 120 億円" }, { op: "setField", idx: "99", text: "z" }]),
      2: "# 次\n\n- 来期の計画（改訂）",
      3: JSON.stringify([{ op: "setCell", row: 1, col: 1, text: "120" }]),
    };
    const r = await batchEditDeck(deck, catalog, {
      indices: [1, 2, 3], instruction: "x",
      aiFix: async (_req, meta) => ({ ok: true, markdown: replies[meta.slideIndex] }),
    });
    expect(r.routes?.map(({ slideIndex, route, skipped, applied }) => ({ slideIndex, route, skipped, applied }))).toEqual([
      { slideIndex: 1, route: "field-ops", skipped: 1, applied: true },
      { slideIndex: 2, route: "markdown", skipped: 0, applied: true },
      { slideIndex: 3, route: "data-ops", skipped: 0, applied: true },
    ]);
  });

  it("refine Lv3: a Markdown condense is recorded as route markdown", async () => {
    const r = await refineDeck(parseMd(LONG_DECK), catalog, { level: 3, aiFix: fixed("# 背景\n\n- 旧CRMは遅くモバイル非対応") });
    expect(r.routes).toEqual([{ slideIndex: 1, route: "markdown", skipped: 0, applied: true }]);
  });
});
