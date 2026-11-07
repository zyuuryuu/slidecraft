/**
 * layout-pick-corpus.test.ts — #589 不変条件「他の出荷テンプレ・第三者マスターの選択結果は 1 枚も変えない」。
 *
 * committed corpus（tests/fixtures/templates ＋ public/templates/slide）の全マスターについて、代表的な
 * スライド（本文 1/2/5 行・段落・図・表・2 カラム・画像・章扉・まとめ）の autoSelectLayout と分割枚数
 * （distillDeck）を snapshot に固定する。snapshot は修正前の main（0627c53）で記録した値。
 *
 * マガジン（#589 の修正対象）は意図して変わるので除外し、magazine-body-layout.test.ts が検査する。
 * corpus は committed のみ（gitignore のローカル専用テンプレは読まない）＝ローカル緑・CI 赤にならない。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { distillDeck } from "../src/engine/distill";

const DIRS = [resolve(__dirname, "fixtures/templates"), resolve(__dirname, "../public/templates/slide")];
const EXCLUDED = /ビジュアルデッキ_マガジン/;

const COVER = "# 表紙\n\nサブタイトル\n\n---\n\n";
const SLIDES: Record<string, string> = {
  oneBullet: "# 要点\n\n- 一行の主張",
  twoBullets: "# 要点\n\n- 一つ目\n- 二つ目",
  fiveBullets: "# 要点\n\n- 一\n- 二\n- 三\n- 四\n- 五",
  twelveBullets: "# 要点\n\n" + Array.from({ length: 12 }, (_, i) => `- 項目${i + 1}の説明文がここに入ります`).join("\n"),
  paragraph: "# 要点\n\n本文の段落です。",
  diagram: "# 構成\n\n```diagram\nnodes:\n  - id: a\n    label: A\n  - id: b\n    label: B\nedges:\n  - from: a\n    to: b\n```",
  table: "# 料金\n\n| プラン | 月額 |\n|---|---|\n| A | 100 |\n| B | 200 |\n| C | 300 |",
  columns: "# 比較\n\n<!-- col -->\n- 左の要点\n\n<!-- col -->\n- 右の要点",
  image: "# 写真\n\n![風景](data:image/png;base64,iVBORw0KGgo=)",
  section: "<!-- section -->\n# 第1章",
  closing: "# まとめ\n\n- 結論",
};

describe("#589 corpus: マガジン以外の全マスターで自動レイアウト選択と分割枚数が不変", () => {
  for (const dir of DIRS) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".pptx") && !EXCLUDED.test(f)).sort()) {
      it(file, async () => {
        const catalog = buildCatalog(await loadTemplate(readFileSync(resolve(dir, file))));
        const out: Record<string, string> = {};
        for (const [k, body] of Object.entries(SLIDES)) {
          const deck = parseMd(COVER + body);
          const n = deck.slides.length;
          const picked = autoSelectLayout(deck.slides[n - 1], n - 1, n, catalog);
          out[k] = `${picked} ×${distillDeck(deck, catalog).slides.length - (n - 1)}`;
        }
        expect(out).toMatchSnapshot();
      });
    }
  }
});
