/**
 * template-writer-body-indent.test.ts — #577: 生成テンプレ（template-writer）の master bodyStyle が
 * lvl1 にしか記号（buChar）を書かず、どの段にも字下げ（marL/indent）を書かなかったため、入れ子箇条
 * （lvl2 以降）が記号なしで lvl1 の本文より左に描かれていた（LibreOffice 実測: lvl2/3 が x=64.7pt、
 * lvl1 本文は x=98.7pt）。プレビューは 1 段ごとに字下げして記号を描くので表示が食い違っていた。
 *
 * 受け入れ基準（Issue #577）:
 *  (a) 生成テンプレの master bodyStyle の lvl1〜5 に marL が単調増加で書かれ、lvl2 以降にも buChar がある。
 *  (b) 1 段あたりの字下げ幅はプレビューと同じ規則（nested-level-font.nestedLevelIndentPt）から導かれる
 *      （R8 一致テスト。プレビュー側の一致は nested-bullets-preview.test.tsx が見る）。
 *  (c) lvl1 の位置は変えない（統括裁定）: lvl1 の marL/indent は修正前の描画位置
 *      （LibreOffice 実測で記号 +8.5pt＝0.3cm・本文 +34.0pt＝1.2cm）と等価な値。
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

const LEVELS = [1, 2, 3, 4, 5];

describe("#577 生成テンプレの master bodyStyle は lvl1〜5 に字下げと記号を書く", () => {
  it("lvl1〜5 すべてに marL があり、単調増加", async () => {
    const bs = await bodyStyleXml();
    const marL = LEVELS.map((n) => levelAttr(bs, n, "marL"));
    expect(marL.every((m) => m !== undefined), `marL=${JSON.stringify(marL)}`).toBe(true);
    for (let i = 1; i < marL.length; i++) expect(marL[i]!).toBeGreaterThan(marL[i - 1]!);
  });

  it("lvl1〜5 すべてに buChar がある（lvl2 以降も記号付き）", async () => {
    const bs = await bodyStyleXml();
    for (const n of LEVELS) expect(levelBlock(bs, n), `lvl${n}`).toMatch(/<a:buChar char="[^"]+"\/>/);
  });

  it("1 段ごとの字下げ幅は規則（nestedLevelIndentPt）から導かれ、記号の吊り下げ（indent）は全段同じ", async () => {
    const bs = await bodyStyleXml();
    const marL1 = levelAttr(bs, 1, "marL")!;
    const indent1 = levelAttr(bs, 1, "indent")!;
    for (const n of LEVELS) {
      expect(levelAttr(bs, n, "marL"), `lvl${n} marL`).toBe(marL1 + Math.round(nestedLevelIndentPt(n - 1) * EMU_PER_PT));
      expect(levelAttr(bs, n, "indent"), `lvl${n} indent`).toBe(indent1);
    }
  });

  it("lvl1 は修正前の描画位置と等価（記号 0.3cm・本文 1.2cm＝marL 431800 / indent -323850 EMU）", async () => {
    const bs = await bodyStyleXml();
    expect(levelAttr(bs, 1, "marL")).toBe(431800);
    expect(levelAttr(bs, 1, "indent")).toBe(-323850);
  });
});
