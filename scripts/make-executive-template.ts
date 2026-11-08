/**
 * make-executive-template.ts — #596: エグゼクティブ プリセットの生成物を決定論的に書き出す。
 *
 *   npx tsx scripts/make-executive-template.ts
 *
 * 出力（どちらも commit 済み・tests/executive-preset-596.test.ts が再生成と中身を照合する golden）:
 *   - public/templates/slide/エグゼクティブ_Executive_TemplateOnly.pptx … writePresetTemplate(EXECUTIVE_PRESET)
 *   - tests/fixtures/templates/エグゼクティブ_Executive_全レイアウト見本.pptx … 全レイアウトを 1 回ずつ使う見本デッキ
 * zip のエントリ日時は固定値に揃える（同じ入力からは同じ bytes）。
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";
import { EXECUTIVE_PRESET, writePresetTemplate } from "../src/engine/template-presets";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { distillDeck } from "../src/engine/distill";
import { generatePptx } from "../src/engine/placeholder-filler";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
export const EXECUTIVE_TEMPLATE_PATH = resolve(ROOT, "public/templates/slide/エグゼクティブ_Executive_TemplateOnly.pptx");
export const EXECUTIVE_FIXTURE_PATH = resolve(ROOT, "tests/fixtures/templates/エグゼクティブ_Executive_全レイアウト見本.pptx");

const SAMPLE = readFileSync(resolve(ROOT, "samples/manuscript-06-executive-brief.md"), "utf8");
// 目標デッキに無い構造の見本（`<!-- section -->` の章扉・タイトルだけの扉・2 列）。締めの直前に差し込む。
const EXTRA = [
  "<!-- section -->\n# 付録 前提と試算",
  "# 試算の前提",
  "# 前提の内訳\n\n<!-- col -->\n- 物流量は 2026 年度実績\n\n<!-- col -->\n- 賃料は現行契約の単価",
];

/** 見本デッキ = 目標デッキ（samples/manuscript-06・10 枚）＋ 締めの直前に 3 枚＝書き出しで全レイアウトを 1 回ずつ使う。 */
export const EXECUTIVE_FIXTURE_MD: string = (() => {
  const parts = SAMPLE.split(/\n---\n/);
  return [...parts.slice(0, -1), ...EXTRA.map((x) => `\n${x}\n`), parts[parts.length - 1]].join("\n---\n");
})();

const FIXED_DATE = new Date(Date.UTC(2026, 10, 8, 0, 0, 0)); // 2026-11-08（#596）

/** zip の全エントリ日時を固定値に揃えて作り直す（中身・順序は不変）。 */
export async function withFixedDates(bytes: Uint8Array): Promise<Uint8Array> {
  const src = await JSZip.loadAsync(bytes);
  const out = new JSZip();
  for (const name of Object.keys(src.files)) {
    const f = src.files[name];
    if (f.dir) continue;
    out.file(name, await f.async("uint8array"), { date: FIXED_DATE, createFolders: false });
  }
  return out.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** 見本デッキの PPTX（`tpl` は出荷テンプレを読んだもの）。 */
export async function buildExecutiveFixture(tpl: TemplateData): Promise<Uint8Array> {
  const deck = distillDeck(parseMd(EXECUTIVE_FIXTURE_MD), buildCatalog(tpl));
  return generatePptx(deck, tpl);
}

async function main(): Promise<void> {
  const template = await withFixedDates(await writePresetTemplate(EXECUTIVE_PRESET));
  writeFileSync(EXECUTIVE_TEMPLATE_PATH, template);
  const fixture = await withFixedDates(await buildExecutiveFixture(await loadTemplate(template)));
  writeFileSync(EXECUTIVE_FIXTURE_PATH, fixture);
  console.log(`wrote ${EXECUTIVE_TEMPLATE_PATH} (${template.length} bytes)\nwrote ${EXECUTIVE_FIXTURE_PATH} (${fixture.length} bytes)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
