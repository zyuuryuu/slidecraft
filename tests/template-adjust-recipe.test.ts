/**
 * template-adjust-recipe.test.ts — #570 段 2: GUI「テンプレ調整」の入力（見出し書体・本文書体・対象・倍率）を
 * adjustTemplate のレシピへ写す純粋ヘルパ。
 *
 * - themeFontSlots: theme の major/minor から latin・ea・script="Jpan" の現在名を読む（loader の themeFonts は
 *   `<a:ea>` しか読まず、日本語 fixture では空なので Jpan を別に読む必要がある — #570 段 1 の実測）。
 * - recipeFor: 選んだ新書体を、その枠の全ての別名（latin／ea／Jpan の名前）からの写像にする。見出しと本文が
 *   同じ名前を共有するテンプレ（技術報告＝Yu Gothic 共通 等）は名前写像では区別できないので「共通」扱い
 *   （fontsLinked）にし、1 つの書体として置き換える。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { themeFontSlots, fontsLinked, recipeFor, adjustTemplate, isNoopRecipe } from "../src/engine/template-adjust";
import { loadTemplate } from "../src/engine/template-loader";

const fx = (f: string) => readFileSync(resolve(__dirname, "fixtures/templates", f));
const themeOf = async (f: string) => (await JSZip.loadAsync(fx(f))).file("ppt/theme/theme1.xml")!.async("string");

describe("themeFontSlots", () => {
  it("Midnight: Georgia/Calibri latin, empty ea, ＭＳ Ｐゴシック Jpan in both", async () => {
    const s = themeFontSlots(await themeOf("Midnight_Executive_30_TemplateOnly.pptx"));
    expect(s.major).toEqual({ latin: "Georgia", ea: "", jpan: "ＭＳ Ｐゴシック" });
    expect(s.minor).toEqual({ latin: "Calibri", ea: "", jpan: "ＭＳ Ｐゴシック" });
  });
  it("magazine: Yu Mincho heading, Yu Gothic body (latin + Jpan)", async () => {
    const s = themeFontSlots(await themeOf("ビジュアルデッキ_マガジン_全レイアウト見本.pptx"));
    expect(s.major).toEqual({ latin: "Yu Mincho", ea: "", jpan: "Yu Mincho" });
    expect(s.minor).toEqual({ latin: "Yu Gothic", ea: "", jpan: "Yu Gothic" });
  });
});

describe("fontsLinked", () => {
  it("separate when heading and body share no name (magazine)", () => {
    expect(fontsLinked({ major: { latin: "Yu Mincho", ea: "", jpan: "Yu Mincho" }, minor: { latin: "Yu Gothic", ea: "", jpan: "Yu Gothic" } })).toBe(false);
  });
  it("linked when any name is shared (Midnight's Jpan, tech's Yu Gothic)", () => {
    expect(fontsLinked({ major: { latin: "Georgia", ea: "", jpan: "ＭＳ Ｐゴシック" }, minor: { latin: "Calibri", ea: "", jpan: "ＭＳ Ｐゴシック" } })).toBe(true);
    expect(fontsLinked({ major: { latin: "Yu Gothic", ea: "", jpan: "Yu Gothic" }, minor: { latin: "Yu Gothic", ea: "", jpan: "Yu Gothic" } })).toBe(true);
  });
});

describe("recipeFor", () => {
  const MAG = { major: { latin: "Yu Mincho", ea: "", jpan: "Yu Mincho" }, minor: { latin: "Yu Gothic", ea: "", jpan: "Yu Gothic" } };
  const MID = { major: { latin: "Georgia", ea: "", jpan: "ＭＳ Ｐゴシック" }, minor: { latin: "Calibri", ea: "", jpan: "ＭＳ Ｐゴシック" } };

  it("nothing chosen + 100% → a no-op recipe", () => {
    const r = recipeFor(MAG, { heading: "", body: "", scope: "theme+inline", scale: { title: 1, body: 1, other: 1 } });
    expect(isNoopRecipe(r)).toBe(true);
  });

  it("separate slots: heading maps only the major names, body only the minor names", () => {
    const r = recipeFor(MAG, { heading: "Meiryo", body: "", scope: "theme+inline", scale: { title: 1, body: 1, other: 1 } });
    expect(r.fonts).toEqual({ latin: [{ from: "Yu Mincho", to: "Meiryo" }], ea: [{ from: "Yu Mincho", to: "Meiryo" }], scope: "theme+inline" });
  });

  it("linked slots: one choice maps every name of both slots", () => {
    const r = recipeFor(MID, { heading: "BIZ UDPGothic", body: "ignored", scope: "theme", scale: { title: 0.9, body: 1, other: 1 } });
    const all = ["Georgia", "ＭＳ Ｐゴシック", "Calibri"].map((from) => ({ from, to: "BIZ UDPGothic" }));
    expect(r.fonts).toEqual({ latin: all, ea: all, scope: "theme" });
    expect(r.scale).toEqual({ title: 0.9, body: 1, other: 1 });
  });

  it("magazine end-to-end: heading → Meiryo changes the theme major + inline Yu Mincho, body Yu Gothic stays", async () => {
    const src = fx("ビジュアルデッキ_マガジン_全レイアウト見本.pptx");
    const out = await adjustTemplate(src, recipeFor(MAG, { heading: "Meiryo", body: "", scope: "theme+inline", scale: { title: 1, body: 1, other: 1 } }));
    const t = await loadTemplate(out);
    expect(t.themeFonts.majorLatin).toBe("Meiryo");
    expect(t.themeFonts.minorLatin).toBe("Yu Gothic");
    const theme = await (await JSZip.loadAsync(out)).file("ppt/theme/theme1.xml")!.async("string");
    expect(theme).toContain('<a:font script="Jpan" typeface="Meiryo"/>');
    expect(theme).toContain('<a:font script="Jpan" typeface="Yu Gothic"/>');
  });
});
