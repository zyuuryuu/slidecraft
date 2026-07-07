/**
 * pptx-wellformed.test.ts — PPTX 内 XML の整形式（well-formedness）回帰ゲート。
 *
 * 発見の経緯: 実機確認プリフライト（python-pptx / expat）で、canonical テンプレの 10 レイアウトが
 * 「<a:prstGeom …> を </p:prstGeom> で閉じる」プレフィックス不一致で厳格パーサ開封不能と判明
 * （scripts/rebuild-template.ts の閉じタグ置換漏れ）。アプリ自身のローダは regex ベースで寛容な
 * ため既存テストでは捕まらなかった。ここでは外部パーサと同じ基準（タグの開閉対応）を依存なしの
 * スタックチェッカで検査し、canonical と template-writer 生成物の両方を恒久ゲートする。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";

const CANON = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

/**
 * 最小の整形式チェック: タグの開閉が prefix 込みで対応しているか（属性値内の <> はクォートで保護）。
 * 完全な XML 検証ではないが、「閉じタグのプレフィックス不一致」というシリアライザ起因の破損クラスを
 * 決定論的に捕まえる。違反メッセージの配列を返す（空 = OK）。
 */
function tagBalanceErrors(xml: string): string[] {
  const errors: string[] = [];
  const stack: string[] = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) break;
    // タグ終端までクォートを尊重して走査
    let j = lt + 1;
    let quote: string | null = null;
    while (j < xml.length) {
      const c = xml[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      j++;
    }
    if (j >= xml.length) {
      errors.push("unterminated tag");
      break;
    }
    const tag = xml.slice(lt + 1, j);
    if (tag.startsWith("?") || tag.startsWith("!")) {
      // XML 宣言・コメント・DOCTYPE はスキップ
    } else if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      const open = stack.pop();
      if (open !== name) errors.push(`mismatch: <${open}> closed by </${name}>`);
    } else if (!tag.endsWith("/")) {
      const name = tag.split(/[\s/]/, 1)[0];
      stack.push(name);
    }
    i = j + 1;
  }
  if (stack.length > 0) errors.push(`unclosed: <${stack.join(">, <")}>`);
  return errors;
}

async function allXmlBalanced(bytes: Uint8Array | Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  const problems: string[] = [];
  for (const name of Object.keys(zip.files).filter((n) => /\.(xml|rels)$/.test(n))) {
    const errs = tagBalanceErrors(await zip.files[name].async("string"));
    for (const e of errs) problems.push(`${name}: ${e}`);
  }
  return problems;
}

describe("tagBalanceErrors（チェッカ自体の健全性）", () => {
  it("プレフィックス不一致の閉じタグを検出する", () => {
    expect(tagBalanceErrors(`<a:prstGeom prst="roundRect"><a:avLst/></p:prstGeom>`)).toEqual([
      "mismatch: <a:prstGeom> closed by </p:prstGeom>",
    ]);
  });
  it("正しい入れ子・自己閉鎖・属性内の山括弧は許容する", () => {
    expect(tagBalanceErrors(`<?xml version="1.0"?><p:sp><a:t attr="a>b"><a:b/></a:t></p:sp>`)).toEqual([]);
  });
});

describe("整形式ゲート — 外部の厳格パーサで開けること", () => {
  it("canonical テンプレの全 XML パートがタグ対応している", async () => {
    expect(await allXmlBalanced(readFileSync(CANON))).toEqual([]);
  });

  it("template-writer 生成物の全 XML パートがタグ対応している", async () => {
    const bytes = await writeTemplate({
      name: "WF Gate",
      fonts: { major: "Georgia", minor: "Calibri" },
      palette: { ...MIDNIGHT_PALETTE },
    });
    expect(await allXmlBalanced(bytes)).toEqual([]);
  });
});
