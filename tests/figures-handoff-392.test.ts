/**
 * figures-handoff-392.test.ts — #392 段 3: 段 2（PR #657）からの申し送り 2 件。
 *
 *  1. field-rescue の出典行（Source:）は、本文枠の画像のキャプション（alt）の下に積む。段 2 までは
 *     **1 枚目の画像**の alt しか見ておらず、2 枚目だけに alt があると出典行がキャプションに重なった。
 *  2. `unboundVisuals`（枠に置けないビジュアル＝描かれないもの）の呼び出し元が段 2 で無くなっていた。
 *     deck-diagnostics の `figure-dropped` がこれを読む（R8: 「描かれない」の判定を 1 つに）。
 *     単一ビジュアルのスライドの診断は従来どおり（ここは変えない・別 Issue）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, findLayout, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { planFieldRescue } from "../src/engine/field-rescue";
import { bindContentByRole } from "../src/engine/placeholder-binding";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { unboundVisuals, figureRegions, imageRect, imageEditGeometry, slideImageEditGeometry, slideImagePlaceholder } from "../src/engine/visual-placement";
import { CAPTION_H } from "../src/engine/image-caption";
import type { DeckIR } from "../src/engine/slide-schema";

const GIJUTSU = resolve(__dirname, "../public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx");
const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const DIAG = (id: string) => "```diagram\ntype: flowchart\nnodes:\n  - id: " + id + "\n    label: " + id + "\n```";

let gijutsu: TemplateData;
let midnight: TemplateData;
beforeAll(async () => {
  [gijutsu, midnight] = await Promise.all([GIJUTSU, MIDNIGHT].map((p) => loadTemplate(readFileSync(p))));
});

const deckOf = (md: string): DeckIR => parseMd("# 表紙\n\n---\n\n" + md);
const layoutOf = (tpl: TemplateData, deck: DeckIR, i: number) =>
  findLayout(tpl, autoSelectLayout(deck.slides[i], i, deck.slides.length, buildCatalog(tpl)))!;
const noteY = (tpl: TemplateData, md: string) => {
  const deck = deckOf(md);
  const layout = layoutOf(tpl, deck, 1);
  return planFieldRescue(deck.slides[1], layout, bindContentByRole(deck.slides[1], layout.placeholders)).note?.rect.y;
};

describe("申し送り 1: 出典行はどの画像のキャプションの下にも積む", () => {
  const two = (altA: string, altB: string) => `# 画像 2 枚\n\n![${altA}](${PNG})\n\n![${altB}](${PNG})\n\nSource: 社内調べ`;
  it("2 枚目だけに alt → 1 枚目だけに alt のときと同じ位置（キャプション 1 行ぶん下）", () => {
    for (const tpl of [gijutsu, midnight]) {
      const none = noteY(tpl, two("", ""));
      const first = noteY(tpl, two("図 A", ""));
      const second = noteY(tpl, two("", "図 B"));
      expect(none).toBeDefined();
      expect(first! - none!).toBeCloseTo(CAPTION_H, 5); // 積む余地がある（下端で詰まっていない）ケース
      expect(second).toBe(first);
    }
  });
  it("単一画像（不変）: alt ありで 1 行ぶん下", () => {
    const one = (alt: string) => `# 画像\n\n![${alt}](${PNG})\n\nSource: 社内調べ`;
    const none = noteY(gijutsu, one(""));
    expect(noteY(gijutsu, one("図 A"))! - none!).toBeCloseTo(CAPTION_H, 5);
  });
});

describe("申し送り 2: figure-dropped は unboundVisuals を読む（R8）", () => {
  it("1 枠のレイアウトに固定した図×2 → figure-dropped の個数 = unboundVisuals の件数", () => {
    const deck = deckOf(`<!-- slide: Content.1Body.Single -->\n# 図 2 つ\n\n${DIAG("a")}\n\n${DIAG("b")}`);
    const layout = layoutOf(midnight, deck, 1);
    const unbound = unboundVisuals(deck.slides[1], layout.placeholders);
    expect(unbound.length).toBeGreaterThan(0);
    const issue = diagnoseDeck(deck, buildCatalog(midnight), midnight.layouts).filter((x) => x.slideIndex === 1 && x.id === "figure-dropped");
    expect(issue).toHaveLength(1);
    expect(issue[0].message).toContain(`（${unbound.length}個）`);
  });
  it("src: deck-diagnostics が unboundVisuals を import している（判定の二重持ちをしない）", () => {
    const src = readFileSync(resolve(__dirname, "../src/engine/deck-diagnostics.ts"), "utf8");
    expect(src).toMatch(/import \{[^}]*\bunboundVisuals\b[^}]*\} from "\.\/visual-placement"/);
  });
});

describe("段 2 への追随: 画像の編集枠（ドラッグ・フォームの X/Y/W/H）は配置後の枠（R8）", () => {
  const TABLE = "| k | v |\n|---|---|\n| a | 1 |";
  it("表＋画像（両方 placeholderIdx 1 で保存 → 画像は 2 つ目の枠に置かれる）: 編集枠 = 描画される枠", () => {
    const deck = deckOf(`# 表と画像\n\n${TABLE}\n\n![写真](${PNG})`);
    const slide = deck.slides[1];
    const layout = layoutOf(midnight, deck, 1);
    expect(slide.image?.placeholderIdx).toBe("1");
    const drawn = figureRegions(slide, layout.placeholders).find((r) => r.figure.kind === "image")!;
    expect(drawn.ordinal).toBe("2");
    expect(slideImagePlaceholder(slide, layout.placeholders)).toBe(drawn.ph);
    expect(slideImageEditGeometry(slide, layout.placeholders)!.box).toEqual(imageRect(slide.image!, drawn.ph));
    expect(imageEditGeometry(slide.image!, layout.placeholders).box).not.toEqual(imageRect(slide.image!, drawn.ph)); // 旧経路は表の枠
  });
  it("単一画像（前面・背面）では従来の imageEditGeometry と一致（不変）", () => {
    for (const md of [`# 画像\n\n![写真](${PNG})`, `# 本文と画像\n\n- 説明\n\n![写真](${PNG})`, `# 背面\n\n![bg](${PNG}){behind=1}\n\n- 本文`]) {
      const deck = deckOf(md);
      for (const tpl of [gijutsu, midnight]) {
        const layout = layoutOf(tpl, deck, 1);
        expect(slideImageEditGeometry(deck.slides[1], layout.placeholders)).toEqual(imageEditGeometry(deck.slides[1].image!, layout.placeholders));
      }
    }
  });
});
