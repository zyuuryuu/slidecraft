/**
 * deck-diagnostics.test.ts — Non-destructive deck review: flags slide-design
 * issues + the levers that would fix each (split/condense/visualize/title).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";

describe("diagnoseDeck", () => {
  it("flags long sentence-bullets (condense) and clean key-value lists (visualize)", () => {
    const deck = parseMd(
      "# 長文\n\n- これは非常に長い文章のままの箇条書きで、キーフレーズになっておらず読みにくい悪い例です\n\n---\n\n# 仕様\n\n- 速度: 0.8秒\n- 重量: 1.2kg\n- 料金: 1200円",
    );
    const issues = diagnoseDeck(deck); // no catalog → box-independent checks only
    expect(issues.some((x) => x.slideIndex === 0 && x.levers.includes("condense"))).toBe(true);
    expect(issues.some((x) => x.slideIndex === 1 && x.levers.includes("visualize"))).toBe(true);
  });

  it("does NOT nudge a table inside a 2-column comparison (a table won't render there)", () => {
    const deck = parseMd(
      "<!-- slide: Column.2Body.Equal -->\n# 比較\n\n- 速度: 3.2秒\n- 対応: 非対応\n- 料金: 850円\n\n<!-- col -->\n\n- 速度: 0.8秒\n- 対応: 完全対応\n- 料金: 1200円",
    );
    expect(diagnoseDeck(deck).some((x) => x.levers.includes("visualize"))).toBe(false);
  });

  it("does NOT nudge a table when key-value values carry parenthetical context", () => {
    // The curated sample's metrics ("利用率: 73%（目標 90%）") read fine as bullets.
    const deck = parseMd(
      "# 指標\n\n- 利用率: 73%（目標 90%）\n- 速度: 3.2秒（業界平均の3倍）\n- 満足度: 5段階中 3.2（前年比 -0.3pt）",
    );
    expect(diagnoseDeck(deck).some((x) => x.levers.includes("visualize"))).toBe(false);
  });

  it("flags a slide that has a body but no title", () => {
    const issues = diagnoseDeck(parseMd("- a\n- b"));
    expect(issues.some((x) => x.levers.includes("title") && x.message.includes("タイトル"))).toBe(true);
  });

  it("flags overflow against the real template (split/condense/visualize)", async () => {
    const tpl = await loadTemplate(readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")));
    const bullets = Array.from({ length: 30 }, (_, i) => `- 項目${i} の説明テキストをそれなりの長さで書く`).join("\n");
    const issues = diagnoseDeck(parseMd(`# 詰め込み\n\n${bullets}`), buildCatalog(tpl));
    expect(issues.some((x) => x.levers.includes("split"))).toBe(true);
  });

  it("a clean short deck has no issues", () => {
    expect(diagnoseDeck(parseMd("# まとめ\n\n- 速い\n- 安い\n- 簡単")).length).toBe(0);
  });

  it("flags 読点「、」 as a strong warning (polish lever)", () => {
    const issues = diagnoseDeck(parseMd("# 概要\n\n- 速く、安く、簡単に導入できる"));
    const dt = issues.find((x) => x.message.includes("読点"));
    expect(dt).toBeTruthy();
    expect(dt!.level).toBe("warn");
    expect(dt!.levers).toContain("polish");
  });

  it("flags 句点「。」 as a light tip (info, polish lever)", () => {
    const issues = diagnoseDeck(parseMd("# 概要\n\n- 導入は容易です。"));
    const ku = issues.find((x) => x.message.includes("句点"));
    expect(ku).toBeTruthy();
    expect(ku!.level).toBe("info");
    expect(ku!.levers).toContain("polish");
    expect(issues.some((x) => x.message.includes("読点"))).toBe(false); // no 、 here
  });

  it("also checks the TITLE, and a punctuation-free deck is clean", () => {
    expect(diagnoseDeck(parseMd("# 速く、確実に\n\n- 要点")).some((x) => x.message.includes("読点"))).toBe(true);
    expect(diagnoseDeck(parseMd("# まとめ\n\n- 速い\n- 安い")).some((x) => x.message.includes("読点") || x.message.includes("句点"))).toBe(false);
  });
});
