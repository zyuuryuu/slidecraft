/**
 * add-magazine-body-layout.ts — one-off: ビジュアルデッキ_マガジン に汎用本文レイアウト
 * `13_本文（1カラム）` を 1 枚追加する (#589)。
 *
 * 病理: マガジンには「タイトル＋本文 1 枠」の汎用レイアウトが無く、汎用本文が `02_ステートメント`
 * （大型 1 文用・本文 2 行枠）に落ちて 3 行以上の本文は自動分割、図は巨大タイトルに重なっていた。
 *
 * 追加するレイアウトは `08_目次` の複製（上部タイトル 30pt＋コーラルのルール線＋本文 1 枠
 * 12.13×4.8in・本文 20pt・背景/配色/書体/フッター線はマガジンのまま）で、名前と creationId だけを
 * 変える。命名は報告書系テンプレの汎用本文 `02_本文（1カラム）` に揃え、番号は既存（00〜12）と
 * 衝突しない 13。
 *
 * ADD-ONLY: 既存パートは 1 byte も変えない（展開後の内容が同一）。差分は
 *  - 新パート ppt/slideLayouts/slideLayout18.xml とその rels（08_目次 の rels と同一＝master のみ参照）、
 *  - master の sldLayoutIdLst 末尾に 1 件・master rels に 1 件・[Content_Types].xml に Override 1 件。
 * 冪等: 既に slideLayout18.xml があるパッケージには触れない。一度実行して結果をコミットする
 * （public/ と tests/fixtures/ の対応物）。
 *
 * Usage: npx tsx scripts/add-magazine-body-layout.ts
 */
import JSZip from "jszip";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const PATHS = [
  "public/templates/slide/ビジュアルデッキ_マガジン_TemplateOnly.pptx",
  "tests/fixtures/templates/ビジュアルデッキ_マガジン_全レイアウト見本.pptx",
];
const SRC = "ppt/slideLayouts/slideLayout13.xml"; // 08_目次
const SRC_RELS = "ppt/slideLayouts/_rels/slideLayout13.xml.rels";
const NEW = "ppt/slideLayouts/slideLayout18.xml";
const NEW_RELS = "ppt/slideLayouts/_rels/slideLayout18.xml.rels";
const NEW_NAME = "13_本文（1カラム）";
const NEW_CREATION_ID = "3589000589";
const MASTER = "ppt/slideMasters/slideMaster1.xml";
const MASTER_RELS = "ppt/slideMasters/_rels/slideMaster1.xml.rels";
const CT = "[Content_Types].xml";
const LAYOUT_CT = "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml";
const LAYOUT_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";

function must(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function patch(path: string): Promise<void> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  if (zip.file(NEW)) {
    console.log(`skip (already patched): ${path}`);
    return;
  }
  const text = (name: string) => zip.file(name)!.async("string");
  const src = await text(SRC);
  must(src.split('name="08_目次"').length === 3, `${path}: ${SRC} is not 08_目次`);
  const layout = src
    .replaceAll('name="08_目次"', `name="${NEW_NAME}"`)
    .replace(/(<p14:creationId [^>]*val=")\d+(")/, `$1${NEW_CREATION_ID}$2`);
  must(layout.includes(`val="${NEW_CREATION_ID}"`), `${path}: creationId not found`);

  const rels = await text(MASTER_RELS);
  const rid = `rId${Math.max(...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1}`;
  const master = await text(MASTER);
  const layoutId = Math.max(...[...master.matchAll(/<p:sldLayoutId id="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  const ct = await text(CT);

  zip.file(MASTER_RELS, rels.replace("</Relationships>", `<Relationship Id="${rid}" Type="${LAYOUT_REL}" Target="../slideLayouts/slideLayout18.xml"/></Relationships>`));
  zip.file(MASTER, master.replace("</p:sldLayoutIdLst>", `<p:sldLayoutId id="${layoutId}" r:id="${rid}"/></p:sldLayoutIdLst>`));
  zip.file(CT, ct.replace("</Types>", `<Override PartName="/${NEW}" ContentType="${LAYOUT_CT}"/></Types>`));
  zip.file(NEW_RELS, await text(SRC_RELS));
  zip.file(NEW, layout);
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log(`patched ${path}: ${rid}, sldLayoutId ${layoutId}`);
}

for (const p of PATHS) await patch(resolve(p));
