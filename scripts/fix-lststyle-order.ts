/**
 * fix-lststyle-order.ts — one-off: 出荷テンプレ 3 種（と全レイアウト見本 fixture）のレイアウト枠の
 * `<a:lstStyle>`（枠に書かれた箇条の段ごとの書式の一覧）の子を規格の順に並べ替える (#604)。
 *
 * 病理: 5 レイアウト 9 枠で子の並びが `lvl2pPr, lvl3pPr, …, lvl9pPr, lvl1pPr`。規格（ECMA-376
 * `CT_TextListStyle`）は `defPPr?, lvl1pPr?, …, lvl9pPr?, extLst?` の順。PowerPoint は要素順が
 * 規格と違うファイルで修復ダイアログを出すことがある。リポジトリ外で作られたテンプレに由来（f83b979）。
 *
 * 修正: 子要素を規格の順へ安定ソートするだけ。要素の中身・属性は 1 文字も変えない。対象 part
 * （slideLayout / slideMaster）のうち並びが変わったものだけを書き戻し、他 part は展開後の内容が同一。
 * 冪等: 既に規格順のパッケージには触れない。一度実行して結果をコミットする（#449・#599 と同じ方式）。
 *
 * fixtures の 報告書テンプレート_* は出荷物ではない取り込み（intake）試験コーパスなので触らない
 * （#449 と同方針。規格外の並びに対する取り込みの頑健性の試験としても残す）。
 *
 * Usage: npx tsx scripts/fix-lststyle-order.ts
 */
import JSZip from "jszip";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "node:url";

export const PATHS = [
  "public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx",
  "public/templates/slide/ビジュアルデッキ_マガジン_TemplateOnly.pptx",
  "public/templates/slide/配布資料_公文書高密度_TemplateOnly.pptx",
  "tests/fixtures/templates/技術報告_スタンダード水色_全レイアウト見本.pptx",
  "tests/fixtures/templates/ビジュアルデッキ_マガジン_全レイアウト見本.pptx",
  "tests/fixtures/templates/配布資料_公文書高密度_全レイアウト見本.pptx",
];

/** 並べ替えの対象 part（レイアウトとマスター）。 */
export const PART_RE = /^ppt\/(slideLayouts\/slideLayout|slideMasters\/slideMaster)\d+\.xml$/;

/** CT_TextListStyle の子の規格順（ECMA-376 Part 1 の XSD にある sequence。全要素が省略可）。 */
export const TEXT_LIST_STYLE_ORDER = [
  "a:defPPr", "a:lvl1pPr", "a:lvl2pPr", "a:lvl3pPr", "a:lvl4pPr",
  "a:lvl5pPr", "a:lvl6pPr", "a:lvl7pPr", "a:lvl8pPr", "a:lvl9pPr", "a:extLst",
];

/** CT_TextListStyle 型の要素（枠の lstStyle と、マスターの txStyles 3 種）。 */
const TEXT_LIST_STYLE_RE = /<(a:lstStyle|p:titleStyle|p:bodyStyle|p:otherStyle)>([\s\S]*?)<\/\1>/g;

export interface Child { name: string; xml: string }

/**
 * 要素の中身 `inner` を直下の子要素に分ける（入れ子は深さで追う＝defRPr の中の extLst は子に数えない）。
 * 子の間に空白以外のテキストがあれば throw（CT_TextListStyle は要素だけを持つ）。
 */
export function splitChildren(inner: string): Child[] {
  const children: Child[] = [];
  const tag = /<(\/?)([\w:]+)\b[^>]*?(\/?)>/g;
  let depth = 0;
  let start = 0;
  let name = "";
  let last = 0;
  for (let m: RegExpExecArray | null; (m = tag.exec(inner)); ) {
    const closing = m[1] === "/";
    const selfClose = m[3] === "/";
    if (depth === 0) {
      if (closing) throw new Error(`unbalanced </${m[2]}>`);
      if (inner.slice(last, m.index).trim()) throw new Error("text between list-style children");
      start = m.index;
      name = m[2];
    }
    if (closing) depth--;
    else if (!selfClose) depth++;
    if (depth === 0) {
      last = tag.lastIndex;
      children.push({ name, xml: inner.slice(start, last) });
    }
  }
  if (depth !== 0 || inner.slice(last).trim()) throw new Error("unbalanced list-style content");
  return children;
}

const rank = (name: string): number => {
  const i = TEXT_LIST_STYLE_ORDER.indexOf(name);
  if (i < 0) throw new Error(`unexpected list-style child <${name}>`);
  return i;
};

/** XML 中の各 CT_TextListStyle 要素の直下の子の名前の並び（検査用）。 */
export function textListStyleChildNames(xml: string): { element: string; children: string[] }[] {
  return [...xml.matchAll(TEXT_LIST_STYLE_RE)].map((m) => ({
    element: m[1],
    children: splitChildren(m[2]).map((c) => c.name),
  }));
}

/** 子の名前の並びが規格順か（重複も不可）。 */
export function isSchemaOrder(children: string[]): boolean {
  return children.every((c, i) => i === 0 || rank(children[i - 1]) < rank(c));
}

/** 規格順でない CT_TextListStyle 要素の子を安定ソートした XML と、並べ替えた要素数。 */
export function reorderTextListStyles(xml: string): { xml: string; reordered: number } {
  let reordered = 0;
  const out = xml.replace(TEXT_LIST_STYLE_RE, (whole, element: string, inner: string) => {
    const children = splitChildren(inner);
    if (isSchemaOrder(children.map((c) => c.name))) return whole;
    if (children.map((c) => c.xml).join("") !== inner) {
      throw new Error(`<${element}> has whitespace between children — refusing to reformat`);
    }
    const sorted = children
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c.name) - rank(b.c.name) || a.i - b.i)
      .map(({ c }) => c.xml)
      .join("");
    reordered++;
    return `<${element}>${sorted}</${element}>`;
  });
  return { xml: out, reordered };
}

async function run(): Promise<void> {
  for (const relPath of PATHS) {
    const path = resolve(relPath);
    const zip = await JSZip.loadAsync(readFileSync(path));
    const changed: string[] = [];
    for (const name of Object.keys(zip.files).filter((f) => PART_RE.test(f)).sort()) {
      const r = reorderTextListStyles(await zip.file(name)!.async("string"));
      if (r.reordered === 0) continue;
      zip.file(name, r.xml);
      changed.push(`${name.replace(/^.*\//, "")}×${r.reordered}`);
    }
    if (changed.length === 0) {
      console.log(`  ${relPath}: list styles already in schema order — skipping (idempotent)`);
      continue;
    }
    writeFileSync(path, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    console.log(`  ${relPath}: reordered ${changed.join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
