/**
 * overflow-scale-hint.test.ts — #570 段 3: 溢れ（*-overflow）が N 件あるとき「本文を 0.9 倍にすると溢れ N→M 件」の
 * 提案を 1 件だけ出す純関数。
 *
 * 仕様（統括の起動プロンプト・Issue #570 段 3）:
 *  - 倍率は 0.95 / 0.9 / 0.85 で試し、溢れが 0 になる最大の倍率を選ぶ（どれも 0 にならなければ、最も減る倍率。
 *    同数なら大きい倍率。1 件も減らないなら提案しない）。
 *  - 容量見積りは placeholderCapacity の 1 経路（diagnoseDeck の body-overflow 判定）のまま。派生テンプレを
 *    adjustTemplate で作り、同じ診断で再評価する（デッキ側に倍率を持たない・R8）。
 *  - 溢れが無いときは何も出さない（既存デッキの診断は不変）。元テンプレの bytes は書き換えない。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { adjustTemplate } from "../src/engine/template-adjust";
import { parseMd } from "../src/engine/md-parser";
import type { DeckIR } from "../src/engine/slide-schema";
import { OVERFLOW_SCALE_CANDIDATES, countOverflows, suggestBodyScale, overflowScaleIssue } from "../src/engine/overflow-scale-hint";

const SRC = new Uint8Array(readFileSync(resolve(__dirname, "fixtures/templates/技術報告_スタンダード水色_全レイアウト見本.pptx")));
let tpl: TemplateData;
let cat: LayoutCatalog;

const deckOf = (bullets: number, chars = 30): DeckIR =>
  parseMd(`# 表紙\n\n---\n\n# 本文\n\n${Array.from({ length: bullets }, (_, i) => `- ${String(i).padStart(2, "0")}${"あ".repeat(chars)}`).join("\n")}`, cat);
const overflows = (deck: DeckIR, t: TemplateData) => countOverflows(diagnoseDeck(deck, buildCatalog(t), t.layouts));

/** The smallest bullet count that overflows the original template (the 0.95 lever should fix a 1-line overflow). */
let justOver: DeckIR;

beforeAll(async () => {
  tpl = await loadTemplate(SRC);
  cat = buildCatalog(tpl);
  for (let n = 1; n < 80; n++) {
    const d = deckOf(n);
    if (overflows(d, tpl) > 0) { justOver = d; break; }
  }
  expect(justOver).toBeDefined();
});

describe("suggestBodyScale", () => {
  it("candidates are exactly 0.95 / 0.9 / 0.85", () => {
    expect([...OVERFLOW_SCALE_CANDIDATES]).toEqual([0.95, 0.9, 0.85]);
  });

  it("no overflow → no suggestion (the deck's diagnostics stay as they were)", async () => {
    const d = deckOf(2);
    expect(overflows(d, tpl)).toBe(0);
    expect(await suggestBodyScale(SRC, d)).toBeUndefined();
  });

  it("an overflow the levers can fix → the LARGEST scale that reaches 0, with N→0 (brute-force agreement)", async () => {
    const s = await suggestBodyScale(SRC, justOver);
    expect(s).toBeDefined();
    const n = overflows(justOver, tpl);
    expect(s!.before).toBe(n);
    expect(s!.after).toBe(0);
    // agreement: re-derive with the same 1 path (adjustTemplate → loadTemplate → diagnoseDeck)
    const zeroAt: number[] = [];
    for (const f of OVERFLOW_SCALE_CANDIDATES) if (overflows(justOver, await loadTemplate(await adjustTemplate(SRC, { scale: { body: f } }))) === 0) zeroAt.push(f);
    expect(s!.scale).toBe(Math.max(...zeroAt));
  });

  it("an overflow no candidate can fix → no suggestion when nothing improves", async () => {
    const d = deckOf(120, 60);
    const n = overflows(d, tpl);
    expect(n).toBeGreaterThan(0);
    const s = await suggestBodyScale(SRC, d);
    if (s) expect(s.after).toBeLessThan(s.before); // only ever a strict improvement
    else {
      for (const f of OVERFLOW_SCALE_CANDIDATES) expect(overflows(d, await loadTemplate(await adjustTemplate(SRC, { scale: { body: f } })))).toBe(n);
    }
  });

  it("the source bytes are not modified", async () => {
    const copy = SRC.slice();
    await suggestBodyScale(SRC, justOver);
    expect(Buffer.compare(Buffer.from(SRC), Buffer.from(copy))).toBe(0);
  });
});

describe("overflowScaleIssue", () => {
  it("one info issue on the first overflowing slide, naming the scale and N→M", () => {
    const issue = overflowScaleIssue({ scale: 0.9, before: 3, after: 1 }, [
      { slideIndex: 4, title: "x", level: "warn", message: "", levers: ["split"], id: "body-overflow" },
      { slideIndex: 2, title: "y", level: "warn", message: "", levers: ["split"], id: "title-overflow" },
    ]);
    expect(issue).toMatchObject({ slideIndex: 2, title: "y", level: "info", id: "overflow-scale-hint", levers: [] });
    expect(issue.message).toContain("0.9 倍");
    expect(issue.message).toContain("3→1 件");
  });
});
