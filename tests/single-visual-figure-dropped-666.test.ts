/**
 * single-visual-figure-dropped-666.test.ts — #666: ビジュアルが 1 つのスライドでも、置き場（本文の枠）が
 * レイアウトに無ければ `figure-dropped`（info）を出す（never-silent）。
 *
 * #392 段 3 で figure-dropped は `unboundVisuals`（visual-placement.ts）を読むようになったが、
 * `regions.length >= 2` のときだけだった＝単一ビジュアルは描かれないのに診断ゼロ。
 * 判定は `unboundVisuals` の 1 経路のまま（R8）。solo 図（序数 1 の図＝全画面が本来の意図）と背面画像は
 * `unboundVisuals` 側で除外済み＝ここでも出ない。
 *
 * 実例: 配布資料_公文書高密度 の 05_比較表 は唯一の body が chrome 帯（#124 のゲートで本文の枠ゼロ）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, findLayout, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { unboundVisuals, bodyPlaceholders } from "../src/engine/visual-placement";
import { RULE_LEVEL } from "../src/engine/review-rules";

const KOUBUN = resolve(__dirname, "../public/templates/slide/配布資料_公文書高密度_TemplateOnly.pptx");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PIN = "<!-- slide: 05_比較表 -->\n";
const TABLE = "| k | v |\n|---|---|\n| a | 1 |";

let tpl: TemplateData;
beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(KOUBUN));
});

const deckOf = (md: string) => parseMd("# 表紙\n\n---\n\n" + md);
const dropped = (md: string) => {
  const deck = deckOf(md);
  return diagnoseDeck(deck, buildCatalog(tpl), tpl.layouts).filter((x) => x.slideIndex === 1 && x.id === "figure-dropped");
};

describe("#666 単一ビジュアルでも置き場が無ければ figure-dropped", () => {
  it("前提: 05_比較表 は本文の枠ゼロ（chrome 帯だけ）", () => {
    expect(bodyPlaceholders(findLayout(tpl, "05_比較表")!.placeholders)).toEqual([]);
  });

  it("本文枠の無いレイアウトに固定した表 1 つ → figure-dropped（info）が 1 件（個数は unboundVisuals と同じ）", () => {
    const md = `${PIN}# 表\n\n${TABLE}`;
    const deck = deckOf(md);
    const layout = findLayout(tpl, autoSelectLayout(deck.slides[1], 1, deck.slides.length, buildCatalog(tpl)))!;
    expect(layout.name).toBe("05_比較表");
    expect(unboundVisuals(deck.slides[1], layout.placeholders)).toEqual([{ kind: "table", placeholderIdx: "1" }]);
    const issues = dropped(md);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe(RULE_LEVEL["figure-dropped"]);
    expect(issues[0].level).toBe("info");
    expect(issues[0].message).toContain("表（1個）");
  });

  it("コードブロック・前面画像 1 つも同様に 1 件", () => {
    expect(dropped(`${PIN}# コード\n\n\`\`\`ts\nconst x = 1;\n\`\`\``)).toHaveLength(1);
    expect(dropped(`${PIN}# 画像\n\n![写真](${PNG})`)).toHaveLength(1);
  });

  it("solo 図（序数 1）は全画面に描かれる＝出ない（unboundVisuals 側の除外をそのまま使う）", () => {
    expect(dropped(`${PIN}# 図\n\n\`\`\`diagram\ntype: flowchart\nnodes:\n  - id: a\n    label: a\n\`\`\``)).toEqual([]);
  });

  it("本文の枠があるレイアウトの表 1 つ → 出ない（過剰報告しない）", () => {
    expect(dropped(`<!-- slide: 03_サマリと詳細 -->\n# 表\n\n${TABLE}`)).toEqual([]);
  });
});
