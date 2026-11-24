/**
 * diagram-fonts-605.test.ts — #605: 書き出した図（```diagram・図形版チャート）の書体がテンプレに関係なく
 * 内蔵 Midnight の Georgia／Calibri になり、日本語用の `<a:ea>` にも Calibri が入っていた
 * （LibreOffice で日本語が重なって描かれる）。
 *
 * 規則（diagram-fonts.ts の 1 か所）: 見出し＝theme の major、本文＝theme の minor。
 *  - latin: theme の `<a:latin>`（無ければ Midnight の Georgia／Calibri）。
 *  - ea: theme の `<a:ea>` → 無ければ `<a:font script="Jpan">` → それも無ければ DEFAULT_EA_FONT（Yu Gothic）。
 * プレビュー（svg-writer）と書き出し（pptx）は同じ解決関数を通る（R8 の一致テストを下に置く）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";
import { generatePptx } from "../src/engine/placeholder-filler";
import { diagramFontsFor, DEFAULT_EA_FONT } from "../src/engine/diagram-fonts";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { parseDiagramYaml } from "../src/engine/diagram-node-shrink";
import { cjkFontFamily } from "../src/engine/font-stack";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard } from "../src/components/SlidePreview";
import { buildCatalog } from "../src/engine/template-catalog";
import { autoSelectLayout, findLayout } from "../src/engine/template-loader";

const TPL = (f: string) => resolve(__dirname, "fixtures/templates", f);
const MAGAZINE = TPL("ビジュアルデッキ_マガジン_全レイアウト見本.pptx");
const MIDNIGHT = TPL("Midnight_Executive_30_TemplateOnly.pptx");

const FLOW = "type: flowchart\nnodes:\n  - id: a\n    label: 入力\n    shape: rounded_rect\n  - id: b\n    label: 処理\n  - id: c\n    label: 出力\nedges:\n  - from: a\n    to: b\n    label: 送る\n  - from: b\n    to: c";
const PIE = "type: pie\ntitle: 市場シェア\nnodes:\n  - id: a\n    label: 製品A\n    value: 42\n  - id: b\n    label: 製品B\n    value: 58";
const deckMd = (yaml: string) => `# 処理の流れ\n\n\`\`\`diagram\n${yaml}\n\`\`\``;

type Run = { latin: string; ea: string; cs: string };
/** Every text run's (latin, ea, cs) typefaces inside the slide's diagram group(s). */
function diagramRuns(slideXml: string): Run[] {
  const grp = slideXml.slice(slideXml.indexOf("<p:grpSp>"));
  return [...grp.matchAll(/<a:rPr\b[\s\S]*?<\/a:rPr>/g)].map((m) => {
    const face = (tag: string) => m[0].match(new RegExp(`<a:${tag} typeface="([^"]*)"`))?.[1] ?? "";
    return { latin: face("latin"), ea: face("ea"), cs: face("cs") };
  }).filter((r) => r.latin !== "");
}

async function slide1(md: string, tpl: TemplateData): Promise<string> {
  const zip = await JSZip.loadAsync(await generatePptx(parseMd(md), tpl));
  return zip.file("ppt/slides/slide1.xml")!.async("string");
}

describe("#605 diagramFontsFor — theme の書体から図の書体を決める（純関数）", () => {
  it("latin は major／minor、ea は theme の ea を最優先", () => {
    expect(diagramFontsFor({ majorLatin: "Arial", minorLatin: "Segoe UI", majorEa: "Meiryo", minorEa: "BIZ UDPGothic", majorJpan: "X", minorJpan: "Y" }))
      .toEqual({ heading: "Arial", body: "Segoe UI", headingEa: "Meiryo", bodyEa: "BIZ UDPGothic" });
  });
  it("ea が空なら script=\"Jpan\" の書体", () => {
    expect(diagramFontsFor({ majorLatin: "Yu Mincho", minorLatin: "Yu Gothic", majorJpan: "Yu Mincho", minorJpan: "Yu Gothic" }))
      .toEqual({ heading: "Yu Mincho", body: "Yu Gothic", headingEa: "Yu Mincho", bodyEa: "Yu Gothic" });
  });
  it("何も無ければ Midnight の latin（Georgia／Calibri）と既定の日本語書体", () => {
    expect(diagramFontsFor(undefined)).toEqual({ heading: "Georgia", body: "Calibri", headingEa: DEFAULT_EA_FONT, bodyEa: DEFAULT_EA_FONT });
    expect(DEFAULT_EA_FONT).toBe("Yu Gothic");
  });
  it("latin の theme 参照（+mj-lt 等）や空文字は実名でないので既定に落とす", () => {
    expect(diagramFontsFor({ majorLatin: "+mn-lt", minorLatin: "", majorEa: "+mj-ea" }))
      .toEqual({ heading: "Georgia", body: "Calibri", headingEa: DEFAULT_EA_FONT, bodyEa: DEFAULT_EA_FONT });
  });
});

describe("#605 受け入れ基準: マガジン（日本語テンプレ）で図を書き出す", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(MAGAZINE)); });

  it("loader が theme の Jpan 書体を読む", () => {
    expect(tpl.themeFonts).toMatchObject({ majorLatin: "Yu Mincho", minorLatin: "Yu Gothic", majorJpan: "Yu Mincho", minorJpan: "Yu Gothic" });
  });

  for (const [name, yaml] of [["flowchart", FLOW], ["図形版チャート（pie）", PIE]] as const) {
    it(`${name}: <a:latin> は theme の書体、<a:ea> は theme の Jpan 書体（Calibri／Georgia が残らない）`, async () => {
      const runs = diagramRuns(await slide1(deckMd(yaml), tpl));
      expect(runs.length).toBeGreaterThan(1);
      for (const r of runs) {
        expect(["Yu Mincho", "Yu Gothic"]).toContain(r.latin);
        expect(r.ea).toBe(r.latin); // マガジンは major/minor とも latin と Jpan が同名
        expect(r.cs).toBe(r.latin);
      }
      expect(runs.some((r) => r.latin === "Yu Gothic")).toBe(true); // 本文（minor）の run がある
    });
  }

  it("見出し（major）の run と本文（minor）の run が分かれる（flowchart: 角丸の太字＝見出し）", async () => {
    const runs = diagramRuns(await slide1(deckMd(FLOW), tpl));
    expect(new Set(runs.map((r) => r.latin))).toEqual(new Set(["Yu Mincho", "Yu Gothic"]));
  });
});

describe("#605 英語テンプレ（Midnight）: latin は従来どおり Georgia／Calibri、ea だけ theme の Jpan", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(MIDNIGHT)); });

  it("flowchart の run は latin ∈ {Georgia, Calibri}・ea＝ＭＳ Ｐゴシック・cs＝latin", async () => {
    const runs = diagramRuns(await slide1(deckMd(FLOW), tpl));
    expect(runs.length).toBeGreaterThan(1);
    for (const r of runs) {
      expect(["Georgia", "Calibri"]).toContain(r.latin);
      expect(r.ea).toBe("ＭＳ Ｐゴシック");
      expect(r.cs).toBe(r.latin);
    }
  });
});

describe("#605 R8 一致テスト: プレビュー（SVG）と書き出し（PPTX）が同じ (latin, ea) を使う", () => {
  for (const [name, file] of [["マガジン", MAGAZINE], ["Midnight", MIDNIGHT]] as const) {
    it(`${name}: SVG の font-family の集合 == PPTX の run の (latin, ea) から作る cjkFontFamily の集合`, async () => {
      const tpl = await loadTemplate(readFileSync(file));
      const runs = diagramRuns(await slide1(deckMd(FLOW), tpl));
      const fromPptx = new Set(runs.map((r) => cjkFontFamily(r.latin, r.ea)));
      const svg = renderDiagramToSvg(parseDiagramYaml(FLOW), { transparent: true, omitTitle: true, fonts: diagramFontsFor(tpl.themeFonts) });
      const fromSvg = new Set([...svg.matchAll(/font-family="([^"]*)"/g)].map((m) => m[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&")));
      expect(fromSvg).toEqual(fromPptx);
    });
  }

  it("fonts 未指定のプレビューは従来どおり（Midnight の Georgia／Calibri）", () => {
    const svg = renderDiagramToSvg(parseDiagramYaml(FLOW), { transparent: true, omitTitle: true });
    const firsts = new Set([...svg.matchAll(/font-family="([^",&]*)/g)].map((m) => m[1]));
    expect(firsts).toEqual(new Set(["Georgia", "Calibri"]));
  });
});

describe("#605 プレビュー（SlideCard）がテンプレの書体で図を描く", () => {
  it("マガジン: 図の SVG の font-family はすべて theme の書体始まり（Georgia／Calibri が無い）", async () => {
    const t = await loadTemplate(readFileSync(MAGAZINE));
    const deck = parseMd(deckMd(FLOW));
    const slide = deck.slides[0];
    const layout = findLayout(t, autoSelectLayout(slide, 0, deck.slides.length, buildCatalog(t)));
    const html = renderToStaticMarkup(createElement(SlideCard, {
      slide, slideIndex: 0, totalSlides: 1, layout, masterBgColor: t.masterBgColor, masterDecorations: t.masterDecorations,
      masterStaticTexts: t.masterStaticTexts, scale: 96, themeFonts: t.themeFonts, exportMode: true,
    }));
    const families = [...html.matchAll(/font-family="([^"]*)"/g)].map((m) => m[1].replace(/&quot;/g, "\""));
    expect(families.length).toBeGreaterThan(1);
    const fonts = diagramFontsFor(t.themeFonts);
    for (const f of families) expect([cjkFontFamily(fonts.heading, fonts.headingEa), cjkFontFamily(fonts.body, fonts.bodyEa)]).toContain(f);
  });
});
