/**
 * sanitize-master.ts — 実テンプレ → 「構造双子（structural twin）」を生成する（master-intake.md §3.1）。
 *
 * 原理: パーサ／スコアラーが消費するのは type・idx・幾何・フォントサイズ・継承・staticText の位置と
 * いった STRUCTURE であり、テキスト内容・画像・ブランド色は（ほぼ）読まない。バグは構造に宿り、
 * 構造は秘密ではない。よって「構造を1bitも変えず、機密（本文テキスト・ロゴ画像・ブランド色・
 * 会社/製品名）だけを落とす」双子を作れば、機密ゼロで parser を回帰検証できる。
 *
 * 保存（＝ロール分類の信号）: <p:ph type/idx> ・ <a:off>/<a:ext> ・ <a:defRPr sz/b> ・ シェイプ構造 ・
 *   name の分類キーワード（NAME_KEYWORDS/CLOSING/ドット family）・staticText の有無と位置。
 * 落とす（＝機密）: <a:t> 本文テキスト ・ ppt/media/* 画像 ・ srgbClr ブランド色（輝度保存でグレー化）・
 *   name の非キーワード部分（社名/製品名）・docProps の title/creator。
 *
 * 忠実性は tests/sanitize-master.test.ts が機械証明する（実物と twin で buildCatalog のロール／
 * detectPathologies の flag が一致）。一致すれば twin は「parser 検証用途で実物と等価」＝コミット可能。
 *
 * Usage: npx tsx scripts/sanitize-master.ts <in.pptx> <out.pptx>
 */
import { readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { layoutRole } from "../src/engine/template-catalog";

// name 由来のロール信号（catalog の NAME_KEYWORDS/CLOSING の複製）。過剰保存は忠実性を壊さない
// （余計に残すだけ）ので、catalog とのドリフトは安全側。忠実性テストが最終ゲート。
const KEYWORD_RES: RegExp[] = [
  /\b(?:two|three|four|2|3|4|multi)\b[\s\S]*\b(?:column|content|panel|box|option)\b|compar|versus|\bvs\b/i,
  /\bcolumn\b/i,
  /\bsection\b|\bdivider\b|\bchapter\b|\bagenda\b|章扉|セクション|区切り|中扉/i,
  /\bcode\b|\blog\b|\bsource\b|コード|ログ|ソース/i,
  /\bclos|\bthank|\bwrap.?up\b|\bnext steps?\b|まとめ|結び|おわりに|謝辞|ご清聴|質疑/i,
  /\bcontent\b|\bbody\b|\bbullet|\btext\b/i,
  /\btitle\b|\bcover\b|\bopening\b|\bintro\b|\bheader\b|表紙|タイトル|扉絵/i,
  /\bsubtitle\b|\bsub\b|サブ|副題/i,
];

/** name をロール分類キーワード＋ドット family＋数字/区切りだけ残して仮名化。 */
export function sanitizeName(name: string): string {
  if (!name) return name;
  const keep = new Array(name.length).fill(false);
  for (const re of KEYWORD_RES) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(name))) {
      for (let i = m.index; i < m.index + m[0].length; i++) keep[i] = true;
      if (m.index === g.lastIndex) g.lastIndex++;
    }
  }
  // ドット family（"Column.3Body" 等）が既知ロールに対応するなら family 部分を保存
  const dot = name.indexOf(".");
  if (dot > 0 && layoutRole(name) !== "other") for (let i = 0; i < dot; i++) keep[i] = true;
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (keep[i] || /[.\d\s_()\-/[\]]/.test(c)) out += c;
    else if (/[A-Za-z]/.test(c)) out += "x";
    else if (/[぀-ヿ㐀-鿿＀-￯]/.test(c)) out += "字"; // CJK/かな/全角
    else out += "";
  }
  return out.trim() || "L";
}

/** srgbClr のブランド色を輝度保存グレーへ（ロール判定に無関係・contrast の明暗だけ残す）。 */
function flattenColor(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const y = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  const h = y.toString(16).padStart(2, "0");
  return (h + h + h).toUpperCase();
}

function sanitizeXml(xml: string): string {
  return xml
    // 本文テキスト（最大の機密）
    .replace(/<a:t>[^<]*<\/a:t>/g, "<a:t>字</a:t>")
    // name 属性（cSld レイアウト名・cNvPr シェイプ名・theme/scheme 名）
    .replace(/name="([^"]*)"/g, (_m, v: string) => `name="${sanitizeName(v)}"`)
    // ブランド色 → 輝度保存グレー
    .replace(/<a:srgbClr val="([0-9A-Fa-f]{6})"/g, (_m, v: string) => `<a:srgbClr val="${flattenColor(v)}"`);
}

function sanitizeDocProps(xml: string): string {
  return xml
    .replace(/<dc:title>[^<]*<\/dc:title>/g, "<dc:title>twin</dc:title>")
    .replace(/<dc:creator>[^<]*<\/dc:creator>/g, "<dc:creator>twin</dc:creator>")
    .replace(/<cp:keywords>[^<]*<\/cp:keywords>/g, "<cp:keywords></cp:keywords>");
}

// 1×1 透明 PNG（ロゴ画像の差し替え。role/binding は画像バイトを読まない）
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** 実テンプレ bytes → 構造双子 bytes。構造を保存し機密のみ落とす。 */
export async function sanitizeMasterBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const out = new JSZip();
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (/^ppt\/media\//.test(path)) {
      out.file(path, PLACEHOLDER_PNG); // ロゴ/画像を差し替え（拡張子は保持＝content-type 整合）
    } else if (/^docProps\//.test(path)) {
      out.file(path, sanitizeDocProps(await file.async("string")));
    } else if (/ppt\/(slideLayouts|slideMasters|theme)\/[^/]+\.xml$/.test(path)) {
      out.file(path, sanitizeXml(await file.async("string")));
    } else {
      out.file(path, await file.async("uint8array")); // 配管（Content_Types・rels・presentation）は素通し
    }
  }
  return out.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function main() {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error("Usage: npx tsx scripts/sanitize-master.ts <in.pptx> <out.pptx>");
    process.exit(1);
  }
  const twin = await sanitizeMasterBytes(readFileSync(inPath));
  writeFileSync(outPath, twin);
  console.log(`wrote twin ${outPath} (${twin.length} bytes)`);
}

// スクリプトとして直接実行された時のみ main（テストから import した時は走らせない）
if (process.argv[1] && /sanitize-master\.ts$/.test(process.argv[1])) void main();
