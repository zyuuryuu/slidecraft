/**
 * diagram-shape-id-unique.test.ts — #441: 図（```diagram）を埋め込んだスライドの <p:cNvPr id> が
 * 重複する。root cause は placeholder-filler.ts の「Re-number shape IDs」が id を 1 つずつ逐次・
 * 全体置換していたこと：振り直し後の値が後続の oldId と一致すると再度書き換わる（old 2→新 4 の後、
 * old 4→新 6 が両方を書き換える）。fix は pptx-writer.renumberShapeIds（文書順 1 パス）への置換。
 *
 * 負側の固定:
 *  - agreement（R8）: 旧ループと renumberShapeIds は「id 値を除いて」同一の XML を返す
 *    （= 図スライドは id 値のみ変化、形状・座標・グループ構造は同一）。
 *  - 旧ループが衝突を起こす最小ケースを明示して root cause を文書化する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";
import { generatePptx } from "../src/engine/placeholder-filler";
import { renumberShapeIds } from "../src/engine/pptx-writer";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

// Issue #441 の repro: 単独の図（flowchart・ノード 2・エッジ 1）と、<!-- col --> の 2 列目の図。
const DIAGRAM_YAML = "type: flowchart\nnodes:\n  - id: a\n    label: 準備\n  - id: b\n    label: 実行\nedges:\n  - from: a\n    to: b";
const SOLO_MD = `# 処理の流れ\n\n\`\`\`diagram\n${DIAGRAM_YAML}\n\`\`\``;
const COL_MD = `# 流れと論点\n\n<!-- col -->\n- 論点その1\n- 論点その2\n\n<!-- col -->\n\`\`\`diagram\n${DIAGRAM_YAML}\n\`\`\``;

async function slide1Xml(md: string, tpl: TemplateData): Promise<string> {
  const zip = await JSZip.loadAsync(await generatePptx(parseMd(md), tpl));
  return zip.file("ppt/slides/slide1.xml")!.async("string");
}

const idsOf = (xml: string) => [...xml.matchAll(/<p:cNvPr[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]));

describe("#441 図スライドの <p:cNvPr id> は一意", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(MIDNIGHT)); });

  it("単独の図: スライド内の id がすべて一意", async () => {
    const xml = await slide1Xml(SOLO_MD, tpl);
    const ids = idsOf(xml);
    expect(ids.length).toBeGreaterThan(3); // 図の shape が実際に載っている
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("列内の図（<!-- col --> 2 列目）: id がすべて一意", async () => {
    const xml = await slide1Xml(COL_MD, tpl);
    expect(xml).toContain("論点その1"); // 箇条書きと図が同居している
    const ids = idsOf(xml);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("グループ（<p:grpSp>）の cNvPr も同じパスで振り直される（nestShapeXml の 7000〜 が残らない）", async () => {
    const xml = await slide1Xml(SOLO_MD, tpl);
    expect(xml).toContain("<p:grpSp>"); // 図はグループ化されて埋め込まれる
    for (const id of idsOf(xml)) expect(id).toBeLessThan(7000);
  });
});

describe("#441 負側: 旧・逐次 replace ループとの agreement（id 値のみ変化）", () => {
  // 旧実装（placeholder-filler.ts にあったループ）をそのまま参照実装として持つ。
  function legacyRenumber(xml: string, start: number): string {
    let id = start;
    let reNumbered = xml;
    const idMatches = [...reNumbered.matchAll(/<p:cNvPr[^>]*id="(\d+)"/g)];
    const usedIds = new Set(idMatches.map((m) => m[1]));
    for (const oldId of usedIds) {
      reNumbered = reNumbered.replace(new RegExp(`id="${oldId}"`, "g"), `id="${id}"`);
      id++;
    }
    return reNumbered;
  }

  // 衝突する最小ケース: old 2 → 新 4 の後、old 4 の置換が「いま振った 4」も書き換える。
  const sp = (id: number) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="S${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${id * 100}" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:sp>`;
  const FRAG = sp(2) + sp(3) + sp(4);
  const START = 4;

  it("旧ループは id を重複させる（root cause の文書化）", () => {
    const ids = idsOf(legacyRenumber(FRAG, START));
    expect(new Set(ids).size).toBeLessThan(ids.length);
  });

  it("renumberShapeIds は一意、かつ id 値を除けば旧ループと byte-identical", () => {
    const fixed = renumberShapeIds(FRAG, START);
    const ids = idsOf(fixed.xml);
    expect(new Set(ids).size).toBe(ids.length);
    expect(fixed.next).toBe(START + ids.length);
    const maskIds = (xml: string) => xml.replace(/(<p:cNvPr[^>]*\bid=")\d+"/g, '$1*"');
    expect(maskIds(fixed.xml)).toBe(maskIds(legacyRenumber(FRAG, START)));
  });
});
