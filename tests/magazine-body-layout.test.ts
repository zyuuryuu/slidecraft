/**
 * magazine-body-layout.test.ts — #589: 出荷テンプレ ビジュアルデッキ_マガジン には「タイトル＋本文 1 枠」の
 * 汎用レイアウトが無く、autoSelectLayout が本文 2 行枠の `02_ステートメント`（大型 1 文用・タイトル 64pt が
 * y≈2.3〜4.9in を占める）を汎用本文に選んでいた。→ 3 行以上の本文は自動分割（distill）で「（続き）」が増え、
 * タイトル＋図 はその巨大タイトルに図が重なる。
 *
 * Fix（裁定 案a・テンプレ側）:
 *  - マガジン（出荷＋全レイアウト見本 fixture）に汎用本文レイアウト `13_本文（1カラム）` を 1 枚追加
 *    （08_目次 と同じ体裁＝上部タイトル＋赤ルール＋本文 1 枠）。既存 13 レイアウトは byte-identical。
 *  - classifyLayout は `ステートメント`／`statement` を新ロール "statement" に分類し、汎用本文
 *    （content）の候補から外す。
 *  - 汎用本文の同点決着（pickLayout の name tie-break）に和名「本文」を加え、ファイル順ではなく名前で
 *    `13_本文（1カラム）` を選ぶ（報告書系テンプレの `02_本文（1カラム）` と同じ命名規約）。
 *
 * 不変条件（他テンプレの選択不変）は layout-pick-corpus.test.ts が走査する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, classifyLayout, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { distillDeck } from "../src/engine/distill";
import { generatePptx } from "../src/engine/placeholder-filler";
import type { DeckIR } from "../src/engine/slide-schema";

const NEW_LAYOUT = "13_本文（1カラム）";
const SHIPPED = resolve(__dirname, "../public/templates/slide/ビジュアルデッキ_マガジン_TemplateOnly.pptx");
const FIXTURE = resolve(__dirname, "fixtures/templates/ビジュアルデッキ_マガジン_全レイアウト見本.pptx");

const FIVE_BULLETS = "# 表紙\n\n---\n\n# 提案の要点\n\n- 現状の課題を整理する\n- 解決策の全体像を示す\n- 導入の段取りを決める\n- 費用対効果を見積もる\n- 次の打ち手を合意する\n";
const DIAGRAM =
  "# 表紙\n\n---\n\n# 構成\n\n```diagram\ntype: flowchart\nnodes:\n  - id: a\n    label: 入力\n  - id: b\n    label: 処理\n  - id: c\n    label: 出力\nedges:\n  - from: a\n    to: b\n  - from: b\n    to: c\n```\n";
const GENERIC_BODIES: Record<string, string> = {
  oneBullet: "# 表紙\n\n---\n\n# 要点\n\n- 一行の主張",
  twoBullets: "# 表紙\n\n---\n\n# 要点\n\n- 一つ目\n- 二つ目",
  fiveBullets: FIVE_BULLETS,
  paragraph: "# 表紙\n\n---\n\n# 要点\n\n本文の段落です。",
  diagram: DIAGRAM,
};

type Box = { x: number; y: number; w: number; h: number };
const intersects = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);

/** Union bbox (inches) of the slide's TOP-LEVEL non-placeholder shapes (= the drawn figure's groups). */
function figureBBox(slideXml: string): Box | undefined {
  const tree = slideXml.slice(slideXml.indexOf("<p:spTree>"), slideXml.lastIndexOf("</p:spTree>"));
  const boxes: Box[] = [];
  // Top-level children only: walk the tree tracking depth of <p:grpSp>/<p:sp> etc.
  const re = /<(\/?)p:(grpSp|sp|cxnSp|graphicFrame|pic)\b[^>]*?(\/?)>/g;
  let depth = 0;
  let start = -1;
  for (let m: RegExpExecArray | null; (m = re.exec(tree)); ) {
    const closing = m[1] === "/", selfClose = m[3] === "/";
    if (!closing && !selfClose) {
      if (depth === 0) start = m.index;
      depth++;
    } else if (closing) {
      depth--;
      if (depth === 0 && start >= 0) {
        const el = tree.slice(start, m.index);
        if (!el.includes("<p:ph")) {
          const off = el.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/);
          if (off) boxes.push({ x: +off[1] / 914400, y: +off[2] / 914400, w: +off[3] / 914400, h: +off[4] / 914400 });
        }
        start = -1;
      }
    }
  }
  if (boxes.length === 0) return undefined;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w)), btm = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: btm - y };
}

for (const [label, file] of [["出荷", SHIPPED], ["全レイアウト見本 fixture", FIXTURE]] as const) {
  describe(`#589 ビジュアルデッキ_マガジン（${label}）: 汎用本文は ${NEW_LAYOUT} へ`, () => {
    let tpl: TemplateData;
    let catalog: LayoutCatalog;
    beforeAll(async () => {
      tpl = await loadTemplate(readFileSync(file));
      catalog = buildCatalog(tpl);
    });
    const pick = (md: string) => {
      const deck = parseMd(md);
      return autoSelectLayout(deck.slides[1], 1, deck.slides.length, catalog);
    };

    it("タイトル＋箇条書き 5 行は分割されず、新レイアウトに入る", () => {
      expect(pick(FIVE_BULLETS)).toBe(NEW_LAYOUT);
      const deck = parseMd(FIVE_BULLETS);
      expect(distillDeck(deck, catalog).slides).toHaveLength(deck.slides.length);
    });

    it("タイトル＋図: 図の bbox がタイトル枠と交差しない", async () => {
      const deck = parseMd(DIAGRAM);
      const layoutName = autoSelectLayout(deck.slides[1], 1, deck.slides.length, catalog);
      expect(layoutName).toBe(NEW_LAYOUT);
      const slides = deck.slides.map((s, i) => ({ ...s, layout: autoSelectLayout(s, i, deck.slides.length, catalog) }));
      const zip = await JSZip.loadAsync(await generatePptx({ ...deck, slides } as DeckIR, tpl));
      const fig = figureBBox(await zip.file("ppt/slides/slide2.xml")!.async("string"));
      expect(fig).toBeDefined();
      const title = tpl.layouts.find((l) => l.name === layoutName)!.placeholders.find((p) => p.type === "title")!.style;
      expect(intersects(fig!, title)).toBe(false);
    });

    it("02_ステートメント は汎用本文（1/2/5 行・段落・図）に選ばれない", () => {
      for (const md of Object.values(GENERIC_BODIES)) expect(pick(md)).not.toBe("02_ステートメント");
      expect(catalog.find((e) => e.name === "02_ステートメント")?.role).toBe("statement");
    });

    it(`${NEW_LAYOUT} の本文枠は 6 行以上入る（2 行枠の ステートメント とは別物）`, () => {
      const body = catalog.find((e) => e.name === NEW_LAYOUT)!.placeholders.find((p) => p.role === "body")!;
      expect(body.maxLines).toBeGreaterThanOrEqual(6);
    });
  });
}

describe("#589 classifyLayout: ステートメント／statement は statement 系（content ではない）", () => {
  const oneBody = { hasTitle: true, hasSubtitle: false, bodyCount: 1 };
  it.each(["02_ステートメント", "Statement", "Big Statement"])("%s → statement", (name) => {
    expect(classifyLayout(name, oneBody)).toBe("statement");
  });
  it("無関係な名前は従来通り（構造で content）", () => {
    expect(classifyLayout("13_本文（1カラム）", oneBody)).toBe("content");
  });
});
