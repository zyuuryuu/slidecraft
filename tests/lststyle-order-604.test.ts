/**
 * lststyle-order-604.test.ts — #604: 出荷テンプレ 3 種（技術報告_スタンダード水色・ビジュアルデッキ_マガジン・
 * 配布資料_公文書高密度）の 5 レイアウト 9 枠で、`<a:lstStyle>` の子が `lvl2pPr…lvl9pPr, lvl1pPr` の
 * 規格外の並びだった（規格 CT_TextListStyle は defPPr?, lvl1pPr?, …, lvl9pPr?, extLst? の順）。
 * PowerPoint の修復ダイアログの原因になり得る。scripts/fix-lststyle-order.ts で並べ替えてコミットした。
 *
 * 受け入れ基準: 出荷テンプレ（public/templates/slide/*.pptx）と対象 fixture 3 種の全 slideLayout／
 * slideMaster で、lstStyle（とマスターの titleStyle/bodyStyle/otherStyle）の子が規格順。
 * 不変条件:
 *  - 並べ替え以外は変えない: 旧い並び（lvl1pPr を末尾へ戻したもの）にスクリプトを掛けると、コミット済みの
 *    part と byte-identical に戻る（＝差分は子の順序だけ）。スクリプトは冪等。
 *  - loadTemplate の結果（LayoutInfo）と catalog は旧い並びと同一。例外は枠の生 XML（shapeXml）で、
 *    これは並べ替えを掛けると一致する（＝読み取った値はすべて不変・生 XML は順序だけ違う）。
 * fixtures の 報告書テンプレート_* は取り込み試験コーパスなので対象外（#449 と同方針）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import {
  PATHS,
  PART_RE,
  splitChildren,
  isSchemaOrder,
  textListStyleChildNames,
  reorderTextListStyles,
} from "../scripts/fix-lststyle-order";

const ROOT = resolve(__dirname, "..");
const SHIPPED_DIR = resolve(ROOT, "public/templates/slide");
const SHIPPED = readdirSync(SHIPPED_DIR).filter((f) => f.endsWith(".pptx")).sort().map((f) => `public/templates/slide/${f}`);
const CHECKED = [...new Set([...SHIPPED, ...PATHS])];

function omit<T extends object>(obj: T, ...keys: string[]): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k))) as Partial<T>;
}

async function parts(relPath: string): Promise<{ zip: JSZip; xml: Map<string, string> }> {
  const zip = await JSZip.loadAsync(readFileSync(resolve(ROOT, relPath)));
  const xml = new Map<string, string>();
  for (const name of Object.keys(zip.files).filter((f) => PART_RE.test(f)).sort()) {
    xml.set(name, await zip.file(name)!.async("string"));
  }
  return { zip, xml };
}

/**
 * 修正前に規格外だった 9 枠（Issue #604 の表）: part → placeholder idx。3 種とも同じ。
 * 同じ part に元から規格順の 9 段 lstStyle を持つ枠がある（技術報告・公文書の slideLayout8 idx=1）ので、
 * 「9 段そろった lstStyle」ではなく枠で特定する。
 */
const LEGACY_SLOTS: Record<string, string[]> = {
  "ppt/slideLayouts/slideLayout1.xml": ["1"], // 00_表紙 subTitle
  "ppt/slideLayouts/slideLayout3.xml": ["1"], // 01_章扉 body
  "ppt/slideLayouts/slideLayout4.xml": ["1", "2"], // 03_本文（2カラム）／03_サマリと詳細
  "ppt/slideLayouts/slideLayout5.xml": ["1", "2", "3", "4"], // 06_まとめ
  "ppt/slideLayouts/slideLayout8.xml": ["2"], // 04_図＋説明／04_フルブリード画像
};
const LVL1_TO_9 = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `a:lvl${n}pPr`).join();

/** 修正前の並び（lvl2…lvl9, lvl1）を再現する: 上の 9 枠の lstStyle の lvl1pPr を末尾へ戻す。 */
function toLegacyOrder(part: string, xml: string): { xml: string; rotated: number } {
  const slots = LEGACY_SLOTS[part] ?? [];
  let rotated = 0;
  const out = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => {
    const idx = sp.match(/<p:ph\b[^>]*\bidx="(\d+)"/)?.[1];
    if (!idx || !slots.includes(idx)) return sp;
    return sp.replace(/<a:lstStyle>([\s\S]*?)<\/a:lstStyle>/, (whole, inner: string) => {
      const kids = splitChildren(inner);
      if (kids.map((k) => k.name).join() !== LVL1_TO_9) return whole;
      rotated++;
      return `<a:lstStyle>${[...kids.slice(1), kids[0]].map((k) => k.xml).join("")}</a:lstStyle>`;
    });
  });
  return { xml: out, rotated };
}

describe("#604 受け入れ: 出荷テンプレの全 slideLayout／slideMaster で list style の子が規格順", () => {
  it.each(CHECKED)("%s", async (relPath) => {
    const { xml } = await parts(relPath);
    const offenders: string[] = [];
    for (const [name, text] of xml) {
      for (const s of textListStyleChildNames(text)) {
        if (!isSchemaOrder(s.children)) offenders.push(`${name} ${s.element} [${s.children.join(",")}]`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("#604 scripts/fix-lststyle-order.ts", () => {
  it("直下の子だけを数え、入れ子（defRPr の中の extLst）は子に数えない", () => {
    const inner =
      '<a:lvl2pPr marL="0"><a:defRPr sz="1200"><a:extLst><a:ext uri="x"/></a:extLst></a:defRPr></a:lvl2pPr>' +
      '<a:lvl1pPr algn="l"/><a:defPPr/>';
    expect(splitChildren(inner).map((c) => c.name)).toEqual(["a:lvl2pPr", "a:lvl1pPr", "a:defPPr"]);
    const r = reorderTextListStyles(`<p:sp><a:lstStyle>${inner}</a:lstStyle></p:sp>`);
    expect(r.reordered).toBe(1);
    expect(r.xml).toBe(
      '<p:sp><a:lstStyle><a:defPPr/><a:lvl1pPr algn="l"/>' +
        '<a:lvl2pPr marL="0"><a:defRPr sz="1200"><a:extLst><a:ext uri="x"/></a:extLst></a:defRPr></a:lvl2pPr>' +
        "</a:lstStyle></p:sp>",
    );
  });

  it.each(PATHS)("冪等: コミット済みの %s には何も変えない", async (relPath) => {
    const { xml } = await parts(relPath);
    for (const [name, text] of xml) {
      const r = reorderTextListStyles(text);
      expect({ name, reordered: r.reordered }).toEqual({ name, reordered: 0 });
      expect(r.xml).toBe(text);
    }
  });

  it.each(PATHS)("差分は順序だけ: %s の旧い並びを直すとコミット済みと byte-identical（9 枠）", async (relPath) => {
    const { xml } = await parts(relPath);
    const rotatedParts: string[] = [];
    let rotatedTotal = 0;
    let reorderedTotal = 0;
    for (const [name, text] of xml) {
      const legacy = toLegacyOrder(name, text);
      if (legacy.rotated > 0) rotatedParts.push(name.replace(/^.*\//, ""));
      rotatedTotal += legacy.rotated;
      const fixed = reorderTextListStyles(legacy.xml);
      reorderedTotal += fixed.reordered;
      expect(fixed.xml).toBe(text);
    }
    expect(rotatedTotal).toBe(9);
    expect(reorderedTotal).toBe(9);
    expect(rotatedParts).toEqual([
      "slideLayout1.xml", "slideLayout3.xml", "slideLayout4.xml", "slideLayout5.xml", "slideLayout8.xml",
    ]);
  });
});

describe("#604 不変条件: loadTemplate の LayoutInfo と catalog は並べ替えの前後で同一", () => {
  it.each(PATHS)("%s", async (relPath) => {
    const { zip, xml } = await parts(relPath);
    for (const [name, text] of xml) zip.file(name, toLegacyOrder(name, text).xml);
    const legacyBuf = await zip.generateAsync({ type: "nodebuffer" });
    const current = await loadTemplate(readFileSync(resolve(ROOT, relPath)));
    const legacy = await loadTemplate(legacyBuf);
    // 枠の生 XML（shapeXml＝スライドへ複製する元）だけは並びが変わる＝並べ替えを掛ければ一致する。
    // 読み取った値（位置・サイズ・段ごとの字の大きさ・揃え・色・記号…）は変換なしで同一。
    let reorderedShapes = 0;
    const legacyLayouts = legacy.layouts.map((l) => ({
      ...l,
      placeholders: l.placeholders.map((ph) => {
        const r = reorderTextListStyles(ph.shapeXml);
        reorderedShapes += r.reordered;
        return { ...ph, shapeXml: r.xml };
      }),
    }));
    expect(reorderedShapes).toBe(9);
    expect(current.layouts).toEqual(legacyLayouts);
    const stripXml = (ls: typeof current.layouts) =>
      ls.map((l) => ({ ...l, placeholders: l.placeholders.map((ph) => omit(ph, "shapeXml")) }));
    expect(stripXml(current.layouts)).toEqual(stripXml(legacy.layouts));
    expect(buildCatalog(current)).toEqual(buildCatalog(legacy));
    // zip（JSZip 本体・組み立て用に保持）と layouts 以外の全フィールド（マスター書式・テーマ等）も同一
    expect(omit(current, "zip", "layouts")).toEqual(omit(legacy, "zip", "layouts"));
  });
});
