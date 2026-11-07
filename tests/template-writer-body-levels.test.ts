/**
 * template-writer-body-levels.test.ts — #574: 生成テンプレ（template-writer）の master bodyStyle が
 * lvl1 しか書かず、入れ子箇条（lvl2 以降）の sz が PowerPoint 既定（18pt）に戻って本文 14pt より
 * 大きく描かれていた。
 *
 * 受け入れ基準（Issue #574）:
 *  (a) 生成テンプレの master bodyStyle に lvl1〜5 の sz が単調非増加で書かれる。
 *  (b) その値はプレビューが使う段階縮小の規則（nested-level-font.nestedLevelFontSize）から導かれ、
 *      loadTemplate で読み戻した本文プレースホルダの levelFontSizes（＝プレビューが描く値）と一致する
 *      （R8 一致テスト: writer とプレビューが同じ規則を 1 か所から使う）。
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { writeTemplate, MIDNIGHT_PALETTE, type TemplateSpec } from "../src/engine/template-writer";
import { loadTemplate } from "../src/engine/template-loader";
import { nestedLevelFontSize } from "../src/engine/nested-level-font";

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

/** lvlNpPr の defRPr sz（centipoints）。書かれていなければ undefined。 */
function levelSz(bodyStyle: string, n: number): number | undefined {
  const block = bodyStyle.match(new RegExp(`<a:lvl${n}pPr\\b[\\s\\S]*?<\\/a:lvl${n}pPr>`))?.[0];
  const sz = block?.match(/<a:defRPr\b[^>]*\bsz="(\d+)"/)?.[1];
  return sz ? parseInt(sz) : undefined;
}

describe("#574 生成テンプレの master bodyStyle は lvl1〜5 の sz を書く", () => {
  it("lvl1〜5 すべてに sz があり、単調非増加", async () => {
    const bs = await bodyStyleXml();
    const sizes = [1, 2, 3, 4, 5].map((n) => levelSz(bs, n));
    expect(sizes.every((s) => s !== undefined), `sizes=${JSON.stringify(sizes)}`).toBe(true);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeLessThanOrEqual(sizes[i - 1]!);
    expect(sizes[1]!).toBeLessThan(sizes[0]!); // lvl2 は本文より小さい（同値で逃げない）
  });

  it("lvl2〜5 の sz は段階縮小の規則（nestedLevelFontSize）から導かれる", async () => {
    const bs = await bodyStyleXml();
    const lvl1Pt = levelSz(bs, 1)! / 100;
    for (const n of [2, 3, 4, 5]) {
      expect(levelSz(bs, n), `lvl${n}`).toBe(Math.round(nestedLevelFontSize(lvl1Pt, n - 1) * 100));
    }
  });

  it("R8 一致: 読み戻した本文の levelFontSizes（プレビューの値）が writer の書いた値と一致する", async () => {
    const bs = await bodyStyleXml();
    const written = [2, 3, 4].map((n) => levelSz(bs, n)! / 100);
    const tpl = await loadTemplate(await writeTemplate(spec()));
    let checked = 0;
    for (const layout of tpl.layouts) {
      for (const ph of layout.placeholders) {
        if (ph.type !== "body") continue;
        // レイアウト側で lvl1 サイズを変えた本文枠は、その枠の lstStyle が lvl2 以降を持たないので
        // master の値を継承する（PowerPoint と同じ）。master と同じ lvl1 の枠で一致を見る。
        if (ph.style.fontSize !== levelSz(bs, 1)! / 100) continue;
        expect(ph.style.levelFontSizes, `${layout.name}/${ph.name}`).toEqual(written);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("#574 lvl1 を master から変えた本文系の枠も入れ子段が lvl1 以下（#449 と同じ不変条件）", () => {
  it("全レイアウトの非タイトル枠で levelFontSizes = その枠の lvl1 から nestedLevelFontSize で導いた値", async () => {
    const tpl = await loadTemplate(await writeTemplate(spec()));
    const offenders: string[] = [];
    let checked = 0;
    for (const layout of tpl.layouts) {
      for (const ph of layout.placeholders) {
        if (ph.type === "title" || ph.type === "ctrTitle") continue;
        const s = ph.style;
        const expected = [1, 2, 3].map((lv) => nestedLevelFontSize(s.fontSize, lv));
        if (JSON.stringify(s.levelFontSizes) !== JSON.stringify(expected)) {
          offenders.push(`${layout.name}/${ph.name}: lvl1=${s.fontSize} nested=${JSON.stringify(s.levelFontSizes)}`);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(offenders, offenders.slice(0, 8).join("\n")).toEqual([]);
  });
});

describe("nestedLevelFontSize（段階縮小の規則・1 か所）", () => {
  it("level 0 は lvl1 そのもの・以降は単調非増加・0.01pt 単位・下限は lvl1 の 60%", () => {
    expect(nestedLevelFontSize(14, 0)).toBe(14);
    let prev = 14;
    for (let lv = 1; lv <= 6; lv++) {
      const v = nestedLevelFontSize(14, lv);
      expect(v).toBeLessThanOrEqual(prev);
      expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6); // 0.01pt 単位
      expect(v).toBeGreaterThanOrEqual(14 * 0.6 - 1e-9);
      prev = v;
    }
  });
});
