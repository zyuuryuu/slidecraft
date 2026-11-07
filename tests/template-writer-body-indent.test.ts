/**
 * template-writer-body-indent.test.ts — #577: 生成テンプレ（template-writer）の master bodyStyle が
 * lvl1 にしか記号（buChar）を書かず、どの段にも字下げ（marL/indent）を書かなかったため、入れ子箇条
 * （lvl2 以降）が記号なしで lvl1 の本文より左に描かれていた（LibreOffice 実測: lvl2/3 が x=64.7pt、
 * lvl1 本文は x=98.7pt）。プレビューは 1 段ごとに字下げして記号を描くので表示が食い違っていた。
 *
 * 受け入れ基準（Issue #577・PR #584 の統括裁定 E で読み替え）:
 *  (a) master bodyStyle の lvl2〜5 に marL が単調増加で書かれ、lvl1 の描画位置より右。lvl2 以降にも buChar がある。
 *  (b) 1 段あたりの字下げ幅はプレビューと同じ規則（nested-level-font.nestedLevelIndentPt）から導かれる
 *      （R8 一致テスト。プレビュー側の一致は nested-indent-preview-agreement.test.tsx が見る）。
 *  (c) lvl1pPr は修正前と byte-identical。lvl1 に marL/indent を書くと、buNone しか書かない記号なし段落
 *      （見出し SlideTitle.Header・本文の普通の段落。md-to-ooxml #103）まで継承して +8.5pt ずれるため。
 *      lvl1 の描画位置は省略時の既定に任せる（LibreOffice 実測で記号 +8.5pt＝0.3cm・本文 +34.0pt＝1.2cm）。
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { writeTemplate, MIDNIGHT_PALETTE, type TemplateSpec } from "../src/engine/template-writer";
import { nestedLevelIndentPt } from "../src/engine/nested-level-font";

const EMU_PER_PT = 12700;
const spec = (): TemplateSpec => ({
  name: "Generated Midnight",
  fonts: { major: "Georgia", minor: "Calibri" },
  palette: { ...MIDNIGHT_PALETTE },
});

async function bodyStyleXml(): Promise<string> {
  const z = await JSZip.loadAsync(await writeTemplate(spec()));
  const master = await z.file("ppt/slideMasters/slideMaster1.xml")!.async("string");
  return master.match(/<p:bodyStyle>[\s\S]*?<\/p:bodyStyle>/)?.[0] ?? "";
}

function levelBlock(bodyStyle: string, n: number): string {
  return bodyStyle.match(new RegExp(`<a:lvl${n}pPr\\b[\\s\\S]*?<\\/a:lvl${n}pPr>`))?.[0] ?? "";
}
function levelAttr(bodyStyle: string, n: number, attr: "marL" | "indent"): number | undefined {
  const open = levelBlock(bodyStyle, n).match(/^<a:lvl\dpPr\b[^>]*>/)?.[0] ?? "";
  const v = open.match(new RegExp(`\\b${attr}="(-?\\d+)"`))?.[1];
  return v === undefined ? undefined : parseInt(v);
}

// 修正前（#574 時点・PR #584 の基底 fcc2eaa）の lvl1pPr。このテンプレ spec での実出力をそのまま固定する。
const LVL1_BEFORE_FIX =
  `<a:lvl1pPr algn="l"><a:spcBef><a:spcPts val="600"/></a:spcBef>` +
  `<a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="•"/>` +
  `<a:defRPr sz="1400"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr>` +
  `</a:lvl1pPr>`;

// lvl1 の描画位置（marL 省略時の既定）。LibreOffice 実測の本文 1.2cm・記号 0.3cm と等価な EMU。
// PowerPoint の省略時既定は未確認（おそらく 0）だが、0 ならこの値より左なので「lvl1 より右」の判定は保守側。
const LVL1_RENDERED_MARL = 431800;
const LVL1_RENDERED_BULLET_X = 431800 - 323850;

const NESTED = [2, 3, 4, 5];

describe("#577 生成テンプレの master bodyStyle は lvl2〜5 に字下げと記号を書き、lvl1 は変えない", () => {
  it("lvl1pPr は修正前と byte-identical（marL/indent を書かない）", async () => {
    const bs = await bodyStyleXml();
    expect(levelBlock(bs, 1)).toBe(LVL1_BEFORE_FIX);
  });

  it("lvl2〜5 すべてに marL があり、単調増加し、lvl1 の描画位置より右（本文・記号とも）", async () => {
    const bs = await bodyStyleXml();
    const marL = NESTED.map((n) => levelAttr(bs, n, "marL"));
    expect(marL.every((m) => m !== undefined), `marL=${JSON.stringify(marL)}`).toBe(true);
    for (let i = 1; i < marL.length; i++) expect(marL[i]!).toBeGreaterThan(marL[i - 1]!);
    expect(marL[0]!).toBeGreaterThan(LVL1_RENDERED_MARL);
    expect(marL[0]! + levelAttr(bs, 2, "indent")!).toBeGreaterThan(LVL1_RENDERED_BULLET_X);
  });

  it("lvl1〜5 すべてに buChar がある（lvl2 以降も記号付き）", async () => {
    const bs = await bodyStyleXml();
    for (const n of [1, ...NESTED]) expect(levelBlock(bs, n), `lvl${n}`).toMatch(/<a:buChar char="[^"]+"\/>/);
  });

  it("1 段ごとの字下げ幅は規則（nestedLevelIndentPt）から導かれ、記号の吊り下げ（indent）は全段同じ", async () => {
    const bs = await bodyStyleXml();
    for (const n of NESTED) {
      expect(levelAttr(bs, n, "marL"), `lvl${n} marL`).toBe(
        LVL1_RENDERED_MARL + Math.round(nestedLevelIndentPt(n - 1) * EMU_PER_PT),
      );
      expect(levelAttr(bs, n, "indent"), `lvl${n} indent`).toBe(LVL1_RENDERED_BULLET_X - LVL1_RENDERED_MARL);
    }
  });
});
