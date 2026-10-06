/**
 * gui-diagnostics-wiring.test.ts — Issue #419: GUI の表示用診断に template.layouts を配線する。
 *
 * unbound-content（このレイアウトに入らず出力時に消える内容の警告、ADR-0030 段階A）は
 * `diagnoseDeck(deck, catalog, layouts)` の 3 引数呼び出しでだけ出る。MCP（get_deck_issues）は
 * 配線済みだが、GUI（useDeckRevise の diagnostics）は 2 引数のままで、GUI では未束縛の内容が
 * 警告なしに消えていた（never-silent の GUI ギャップ）。
 *
 * この repo の流儀（hook は renderHook せず、hook が一行で呼ぶ純粋関数を直接駆動 —
 * 手本: tests/gui-serialize-binding-plan.test.ts）で、配線点 `reviseDiagnostics` を固定する。
 * refine ループの収束判定（refine.ts の 2 引数 diagnoseDeck）はこの Issue では変えない。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { reviseDiagnostics } from "../src/components/useDeckRevise";
import type { DeckIR, SlideIR } from "../src/engine/slide-schema";

// コールアウト枠（Takeaway: の専用枠）が無いテンプレ — Issue #419 repro のテンプレ系。
const GIJUTSU = resolve(__dirname, "../public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx");

// #397 のフィールド行つきスライド。枠の無いテンプレでは callout が未束縛になる。
const TAKEAWAY_MD = "# 売上は回復基調\n\n- 3Q は前年比 +12%\n- 新規顧客が牽引\n\nTakeaway: 結論はこれ";
const HEALTHY_MD = "# 売上は回復基調\n\n- 3Q は前年比 +12%\n- 新規顧客が牽引";

/** index-0 の表紙 coercion を避けるため、対象スライドを 3 枚デッキの中央に置く（field-rows.test と同じ）。 */
const asMiddle = (s: SlideIR): DeckIR => ({ slides: [{ layout: "auto", placeholders: [] }, s, { layout: "auto", placeholders: [] }] });

describe("issue #419 — GUI 表示用診断（reviseDiagnostics）が layouts 経由", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(GIJUTSU));
    catalog = buildCatalog(tpl);
  });

  it("枠の無いテンプレ + Takeaway: 行 → unbound-content が 1 件（行名入り）出る", () => {
    const deck = asMiddle(parseMd(TAKEAWAY_MD).slides[0]);
    const issues = reviseDiagnostics(deck, catalog, tpl).filter((i) => i.id === "unbound-content");
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warn");
    expect(issues[0].message).toContain("Takeaway");
  });

  it("健全デッキ → 2 引数 diagnoseDeck と deep-equal（診断は 1 件も増えない）", () => {
    const deck = asMiddle(parseMd(HEALTHY_MD).slides[0]);
    expect(reviseDiagnostics(deck, catalog, tpl)).toEqual(diagnoseDeck(deck, catalog));
  });

  it("テンプレ未ロード（templateData null）→ 2 引数経路と byte-identical", () => {
    const deck = asMiddle(parseMd(TAKEAWAY_MD).slides[0]);
    expect(reviseDiagnostics(deck, catalog, null)).toEqual(diagnoseDeck(deck, catalog));
  });

  it("deck / catalog 未準備 → []（hook の従来挙動）", () => {
    expect(reviseDiagnostics(null, catalog, tpl)).toEqual([]);
    expect(reviseDiagnostics(asMiddle(parseMd(HEALTHY_MD).slides[0]), undefined, tpl)).toEqual([]);
  });
});
