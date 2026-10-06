/**
 * nested-bullet-template-sizes.test.ts — #449: 同梱テンプレでネスト箇条書き（lvl≥1）が親（lvl0）より
 * 大きく出る。root cause はレイアウトの本文 lstStyle が lvl1pPr の sz しか持たず、lvl2 以降が master
 * bodyStyle の lvl2pPr sz=2800 / lvl3pPr sz=2400 に落ちること（例: 技術報告_スタンダード水色 の
 * slideLayout2 は lvl1=1600 のみ → ネスト段が 28pt/24pt）。
 *
 * 受け入れ基準（Issue #449）: 同梱テンプレの本文プレースホルダで、解決後の lvl2/3/4 サイズが
 * lvl1（fontSize）以下であること — template-loader の levelFontSizes で検査する。
 * 対象は出荷している public/templates/slide の 4 本と、tests/fixtures のその対応物（全レイアウト見本）。
 * fixtures の 報告書テンプレート_* は出荷物ではない intake 試験コーパスなので対象外。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";

const PUBLIC_DIR = resolve(__dirname, "../public/templates/slide");
const FIXTURE_DIR = resolve(__dirname, "fixtures/templates");

const BUNDLED: Array<[string, string]> = [
  [PUBLIC_DIR, "Midnight_Executive_30_TemplateOnly.pptx"],
  [PUBLIC_DIR, "技術報告_スタンダード水色_TemplateOnly.pptx"],
  [PUBLIC_DIR, "ビジュアルデッキ_マガジン_TemplateOnly.pptx"],
  [PUBLIC_DIR, "配布資料_公文書高密度_TemplateOnly.pptx"],
  // public 同梱テンプレの fixtures 対応物（同じマスター/レイアウトの全レイアウト見本）
  [FIXTURE_DIR, "Midnight_Executive_30_TemplateOnly.pptx"],
  [FIXTURE_DIR, "技術報告_スタンダード水色_全レイアウト見本.pptx"],
  [FIXTURE_DIR, "ビジュアルデッキ_マガジン_全レイアウト見本.pptx"],
  [FIXTURE_DIR, "配布資料_公文書高密度_全レイアウト見本.pptx"],
];

describe("#449 同梱テンプレ: 本文のネスト段（lvl2-4）は lvl1 以下のサイズに解決される", () => {
  it.each(BUNDLED.map(([dir, file]) => [file, dir] as const))("%s", async (file, dir) => {
    const tpl = await loadTemplate(readFileSync(resolve(dir, file)));
    const offenders: string[] = [];
    for (const layout of tpl.layouts) {
      for (const ph of layout.placeholders) {
        // type="body" 明示と、type 属性なし（loader は "" 番兵・OOXML 既定は body）の両方が本文枠
        if (ph.type !== "body" && ph.type !== "") continue;
        const s = ph.style;
        (s.levelFontSizes ?? []).forEach((lv, i) => {
          if (lv !== undefined && lv > s.fontSize) {
            offenders.push(`${layout.name} / ${ph.name} (idx=${ph.idx}): lvl${i + 2}=${lv}pt > lvl1=${s.fontSize}pt`);
          }
        });
      }
    }
    expect(offenders, offenders.slice(0, 8).join("\n")).toEqual([]);
  });
});
