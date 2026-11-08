/**
 * template-adjust-body-max-635.test.ts — PR #635 統括裁定 B: 本文倍率の上限 `scale.bodyMaxPt`。
 *
 * 本文倍率（scale.body）は既定では本文系の枠すべてに掛かる。`bodyMaxPt` を指定すると、倍率前のサイズが
 * その値以下の枠（本文の大きさの帯）だけに掛かり、それより大きい表示用サイズの枠（大数字など）は据え置く。
 * 判定は**枠ごと**（その枠の lstStyle の最大 sz＝lvl1）。入れ子段（lvl2〜5）は lvl1 から導いた小さい値
 * （#574）なので、段ごとに判定すると 22pt の枠の lvl2 だけが拡大されて親子が逆転する。
 * 既定（undefined）は従来どおり全枠（#570/#594 の既存出力は不変）。
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { writeTemplate, MIDNIGHT_PALETTE, type TemplateSpec } from "../src/engine/template-writer";
import type { LayoutDef } from "../src/engine/template-layout-library";
import { adjustTemplate, scaleSz } from "../src/engine/template-adjust";

// 本文系の枠 2 つ（21pt＝上限ちょうど・22pt＝上限超え）を持つ検証用レイアウト。
const BOUNDARY_LAYOUT: LayoutDef = {
  name: "Test.Boundary.BodyMax",
  family: "light",
  placeholders: [
    { name: "SlideTitle.Header", type: "body", idx: 15, x: 0.8, y: 0.1, w: 10, h: 0.52, fontSize: 28, font: "major", color: "titleText", bold: true, align: "l" },
    { name: "Body21.Left", type: "body", idx: 1, x: 0.8, y: 1.45, w: 5.5, h: 5.4, fontSize: 21, font: "minor", color: "bodyText", bold: false, align: "l" },
    { name: "Body22.Right", type: "body", idx: 2, x: 6.8, y: 1.45, w: 5.5, h: 5.4, fontSize: 22, font: "minor", color: "bodyText", bold: false, align: "l" },
  ],
};
const spec = (): TemplateSpec => ({ name: "BodyMax", fonts: { major: "Georgia", minor: "Calibri" }, palette: { ...MIDNIGHT_PALETTE }, layouts: [BOUNDARY_LAYOUT] });

const FACTOR = 20 / 14;
const sizesOf = (xml: string) => [...xml.matchAll(/<a:defRPr\b[^>]*\bsz="(\d+)"/g)].map((m) => Number(m[1]));
/** 名前で引いた `<p:sp>` の defRPr sz（lvl1 → lvl5 の順）。 */
const spSizes = (xml: string, name: string) => sizesOf(xml.match(new RegExp(`<p:sp>(?:(?!</p:sp>).)*?name="${name.replace(/\./g, "\\.")}"(?:(?!</p:sp>).)*</p:sp>`))![0]);
const layoutXml = async (bytes: Uint8Array) => {
  const z = await JSZip.loadAsync(bytes);
  for (const p of Object.keys(z.files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))) {
    const xml = await z.file(p)!.async("string");
    if (xml.includes(`name="${BOUNDARY_LAYOUT.name}"`)) return xml;
  }
  throw new Error("layout not found");
};
const masterBodyLvl1 = async (bytes: Uint8Array) =>
  Number((await (await JSZip.loadAsync(bytes)).file("ppt/slideMasters/slideMaster1.xml")!.async("string"))
    .match(/<p:bodyStyle><a:lvl1pPr[^>]*>(?:(?!<\/a:lvl1pPr>).)*<a:defRPr sz="(\d+)"/)![1]);

describe("scale.bodyMaxPt — 本文倍率を本文の大きさの帯の枠に限る", () => {
  it("境界: 21pt の枠は倍率の対象（入れ子段も）、22pt の枠は据え置き（入れ子段も）", async () => {
    const base = await writeTemplate(spec());
    const before = await layoutXml(base);
    const after = await layoutXml(await adjustTemplate(base, { scale: { body: FACTOR, bodyMaxPt: 21 } }));
    const b21 = spSizes(before, "Body21.Left");
    const b22 = spSizes(before, "Body22.Right");
    expect(b21[0]).toBe(2100);
    expect(b21.length).toBe(5); // lvl1 + 入れ子 lvl2〜5
    expect(b22[0]).toBe(2200);
    expect(spSizes(after, "Body21.Left")).toEqual(b21.map((sz) => scaleSz(sz, FACTOR))); // 21pt → 30pt
    expect(spSizes(after, "Body22.Right")).toEqual(b22); // 据え置き（lvl2 の 19pt 前後も拡大しない）
  });

  it("master の本文スタイル（14pt）は倍率の対象", async () => {
    const out = await adjustTemplate(await writeTemplate(spec()), { scale: { body: FACTOR, bodyMaxPt: 21 } });
    expect(await masterBodyLvl1(out)).toBe(2000);
  });

  it("既定（bodyMaxPt なし）は従来どおり全枠に掛かる", async () => {
    const base = await writeTemplate(spec());
    const before = await layoutXml(base);
    const plain = await adjustTemplate(base, { scale: { body: FACTOR } });
    const after = await layoutXml(plain);
    expect(spSizes(after, "Body22.Right")).toEqual(spSizes(before, "Body22.Right").map((sz) => scaleSz(sz, FACTOR)));
    // bodyMaxPt を十分大きく取れば既定と同じ bytes（上限が効かない時は経路が変わらない）
    const huge = await adjustTemplate(base, { scale: { body: FACTOR, bodyMaxPt: 400 } });
    expect(huge).toEqual(plain);
  });

  it("本文倍率が 1 なら上限があっても無変換（入力と byte-identical）", async () => {
    const base = await writeTemplate(spec());
    expect(await adjustTemplate(base, { scale: { body: 1, bodyMaxPt: 21 } })).toEqual(base);
  });

  it("bodyMaxPt は正の有限値（不正値は RangeError）", async () => {
    const base = await writeTemplate(spec());
    await expect(adjustTemplate(base, { scale: { body: FACTOR, bodyMaxPt: 0 } })).rejects.toThrow(RangeError);
    await expect(adjustTemplate(base, { scale: { body: FACTOR, bodyMaxPt: Number.NaN } })).rejects.toThrow(RangeError);
  });
});
