/**
 * figures-placement-392.test.ts — #392 段 2（配置と描画）の受け入れテスト。
 *
 * 段 1 で SlideIR に残るようになった複数ビジュアル（`figures`）を、別々の body 枠に置いて描く。
 * - ordinal（何番目の body 枠に置くか）の解決は `placedFigures(slide)` の 1 経路（R8）。SlideIR 自体は
 *   書き換えない（md／.scft はそのまま＝round-trip 不変）。
 * - ビジュアルが 1 つのスライドは従来どおり（solo＝全面表示を含む）。byte-identical は段 0 の固定テストが検査。
 * - 置き場（body 枠）が足りないテンプレでは、置けないビジュアルを `figure-dropped`（info）で告知（never-silent）。
 *
 * 受け入れ基準（Issue #392）: (a) ```diagram×2 → 第 1／第 2 body 枠に別々に描く、(b) 表＋図 → 重ならず並置
 * （visual-collision の warn が消える）、(c) round-trip 安定。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { loadTemplate, autoSelectLayout, slideRoleRegions, suggestLayouts, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { generatePptx } from "../src/engine/placeholder-filler";
import { placedFigures } from "../src/engine/figure-placement";
import { figureRegions, visualCollisions, unboundVisuals } from "../src/engine/visual-placement";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import type { DeckIR } from "../src/engine/slide-schema";

const ROOT = resolve(__dirname, "..");
const MIDNIGHT = resolve(ROOT, "tests/fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"); // Chart.2Chart.Equal を持つ
const TECH = resolve(ROOT, "public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx"); // 2 カラムあり・Chart 無し
const PITCH = resolve(ROOT, "public/templates/slide/セールスピッチ_Pitch_TemplateOnly.pptx"); // 2 カラム無し（3 カラムのみ）

const DIAG = (label: string) => "```diagram\ntype: flowchart\nnodes:\n  - id: n\n    label: " + label + "\n```";
const TABLE = "| 指標 | 値 |\n|---|---|\n| 売上 | 100 |";
/** 表紙 + 対象スライド（index 1）。 */
const deckOf = (body: string): DeckIR => parseMd(`# 表紙\n\n---\n\n# 対象\n\n${body}\n`);
const target = (body: string) => deckOf(body).slides[1];
const ordinals = (body: string) => placedFigures(target(body)).map((p) => [p.figure.kind, p.ordinal, p.solo]);

const DD = `${DIAG("一つ目")}\n\n${DIAG("二つ目")}`;
const TD = `${TABLE}\n\n${DIAG("図のノード")}`;
const DT = `${DIAG("図のノード")}\n\n${TABLE}`;
const COL = `<!-- col -->\n- 左の本文\n\n<!-- col -->\n${DIAG("右の図")}`;

let midnight: TemplateData, tech: TemplateData, pitch: TemplateData;
beforeAll(async () => {
  midnight = await loadTemplate(readFileSync(MIDNIGHT));
  tech = await loadTemplate(readFileSync(TECH));
  pitch = await loadTemplate(readFileSync(PITCH));
});

describe("#392 段 2: placedFigures — ordinal の唯一の解決経路", () => {
  it("ビジュアル 1 つは従来どおり（図だけ＝ordinal 1 の solo、本文の隣＝ordinal 2）", () => {
    expect(ordinals(DIAG("a"))).toEqual([["diagram", "1", true]]);
    expect(ordinals(`- 本文\n\n${DIAG("a")}`)).toEqual([["diagram", "2", false]]);
    expect(ordinals(TABLE)).toEqual([["table", "1", false]]);
    expect(ordinals(COL)).toEqual([["diagram", "2", false]]);
  });
  it("(a) 図×2 → ordinal 1・2（出現順）。どちらも solo（全面）にしない", () => {
    expect(ordinals(DD)).toEqual([["diagram", "1", false], ["diagram", "2", false]]);
  });
  it("(b) 表＋図／図＋表 → 出現順に 1・2（ordinal の衝突を解く）", () => {
    expect(ordinals(TD)).toEqual([["table", "1", false], ["diagram", "2", false]]);
    expect(ordinals(DT)).toEqual([["diagram", "1", false], ["table", "2", false]]);
  });
  it("本文＋図×2 → 本文が 1、図が 2・3（#390 の「本文があれば 2 へ」と整合）", () => {
    expect(ordinals(`- 本文\n\n${DD}`)).toEqual([["diagram", "2", false], ["diagram", "3", false]]);
  });
  it("SlideIR は書き換えない（placeholderIdx は parse のまま＝md／.scft は不変）", () => {
    expect(target(DD).figures?.map((f) => f.placeholderIdx)).toEqual(["1", "1"]);
  });
});

describe("#392 段 2: レイアウト選択が「ビジュアル 2 つ」を見る", () => {
  it("図×2（本文なし）→ role chart・2 枠。テンプレ無しの既定は Chart.2Chart.Equal", () => {
    const d = deckOf(DD);
    expect(slideRoleRegions(d.slides[1], 1, 2)).toEqual({ role: "chart", regions: 2, fallback: "Chart.2Chart.Equal" });
    expect(autoSelectLayout(d.slides[1], 1, 2)).toBe("Chart.2Chart.Equal");
  });
  it("図×2 → Chart.2Chart.Equal を持つテンプレではそれを選び、suggestLayouts の先頭も同じ", () => {
    const d = deckOf(DD);
    const cat = buildCatalog(midnight);
    expect(autoSelectLayout(d.slides[1], 1, 2, cat)).toBe("Chart.2Chart.Equal");
    expect(suggestLayouts(d.slides[1], 1, 2, cat)[0]).toBe("Chart.2Chart.Equal");
  });
  it("図×2 → Chart 2 枠の無いテンプレでは 2 カラムへ退化（Callout 付き本文レイアウトには行かない）", () => {
    const d = deckOf(DD);
    const cat = buildCatalog(tech);
    const name = autoSelectLayout(d.slides[1], 1, 2, cat);
    expect(cat.find((e) => e.name === name)).toMatchObject({ role: "columns", bodyCount: 2 });
  });
  it("図×2 → Chart 2 枠の無いテンプレで Chart.1Chart.Single+1Analysis（分析枠に 2 つ目が入る）を選ばず 2 カラムへ退化（PR #657 D1）", () => {
    const d = deckOf(DD);
    const cat = buildCatalog(midnight).filter((e) => e.name !== "Chart.2Chart.Equal");
    expect(cat.some((e) => e.name === "Chart.1Chart.Single+1Analysis" && e.bodyCount === 2)).toBe(true); // 前提: 罠の候補が残っている
    const name = autoSelectLayout(d.slides[1], 1, 2, cat);
    expect(name).not.toBe("Chart.1Chart.Single+1Analysis");
    expect(cat.find((e) => e.name === name)).toMatchObject({ role: "columns", bodyCount: 2 });
    expect(suggestLayouts(d.slides[1], 1, 2, cat)[0]).toBe(name);
  });
  it("表＋図 → columns 2（Column.2Body.*）", () => {
    const d = deckOf(TD);
    expect(slideRoleRegions(d.slides[1], 1, 2)).toEqual({ role: "columns", regions: 2, fallback: "Column.2Body.Equal" });
    expect(autoSelectLayout(d.slides[1], 1, 2, buildCatalog(midnight))).toMatch(/^Column\.2Body\./);
  });
  it("本文＋図×2 → columns 3", () => {
    expect(slideRoleRegions(target(`- 本文\n\n${DD}`), 1, 2)).toMatchObject({ role: "columns", regions: 3 });
  });
});

describe("#392 段 2: 配置 — 別々の body 枠（重ならない）", () => {
  const regionsOn = (tpl: TemplateData, body: string) => {
    const d = deckOf(body);
    const layout = findLayout(tpl, autoSelectLayout(d.slides[1], 1, 2, buildCatalog(tpl)))!;
    return { slide: d.slides[1], phs: layout.placeholders, regions: figureRegions(d.slides[1], layout.placeholders) };
  };
  it("(a) 図×2 → 2 つの異なる body 枠（Midnight: Chart.2Chart.Equal の左右）", () => {
    const { regions } = regionsOn(midnight, DD);
    const idxs = regions.map((r) => r.ph?.idx);
    expect(idxs.every(Boolean)).toBe(true);
    expect(new Set(idxs).size).toBe(2);
    expect(regions[0].ph!.style.x).toBeLessThan(regions[1].ph!.style.x); // 出現順＝左→右
  });
  for (const [name, get] of [["Midnight", () => midnight], ["技術報告", () => tech], ["Pitch", () => pitch]] as const) {
    it(`(b) 表＋図 → 衝突なし・未束縛なし（${name}）`, () => {
      const { slide, phs, regions } = regionsOn(get(), TD);
      expect(visualCollisions(slide, phs)).toEqual([]);
      expect(unboundVisuals(slide, phs)).toEqual([]);
      expect(new Set(regions.map((r) => r.ph?.idx)).size).toBe(2);
    });
  }
});

/** slide XML の、text を含む最初の <p:sp> の a:off x（EMU）。 */
function shapeX(xml: string, text: string): number {
  const sps = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? [];
  const sp = sps.find((s) => s.includes(text));
  if (!sp) throw new Error(`no shape with ${text}`);
  return parseInt(sp.match(/<a:off x="(\d+)"/)![1]);
}

describe("#392 段 2: PPTX — 2 つとも描く", () => {
  const slideXml = async (deck: DeckIR, tpl: TemplateData, n = 2) =>
    (await JSZip.loadAsync(await generatePptx(deck, tpl))).file(`ppt/slides/slide${n}.xml`)!.async("string");
  it("(a) 図×2 → 一つ目は左の枠、二つ目は右の枠に描かれる（Midnight）", async () => {
    const xml = await slideXml(deckOf(DD), midnight);
    expect(xml).toContain("一つ目");
    expect(xml).toContain("二つ目");
    const right = findLayout(midnight, "Chart.2Chart.Equal")!.placeholders.find((p) => p.idx === "2")!.style;
    expect(shapeX(xml, "一つ目")).toBeLessThan(right.x * 914400);
    expect(shapeX(xml, "二つ目")).toBeGreaterThanOrEqual(right.x * 914400);
  });
  it("(b) 表＋図 → 表（graphicFrame）と図の両方が描かれ、図は表の枠の外", async () => {
    const xml = await slideXml(deckOf(TD), tech);
    expect(xml).toContain("<a:tbl>");
    expect(xml).toContain("図のノード");
    const frame = xml.match(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/)![0];
    const [, fx] = frame.match(/<a:off x="(\d+)"/)!;
    const [, fcx] = frame.match(/<a:ext cx="(\d+)"/)!;
    expect(shapeX(xml, "図のノード")).toBeGreaterThanOrEqual(parseInt(fx) + parseInt(fcx)); // 表の右隣
  });
  it("表×2 → 表が 2 つ描かれる", async () => {
    const xml = await slideXml(deckOf(`${TABLE}\n\n${TABLE.replace("100", "200")}`), tech);
    expect(xml.match(/<a:tbl>/g)).toHaveLength(2);
    expect(xml).toContain("200");
  });
});

describe("#392 段 2: never-silent — 置けないものだけ告知", () => {
  const issues = (deck: DeckIR, tpl: TemplateData) => diagnoseDeck(deck, buildCatalog(tpl), tpl.layouts);
  it("(b) 表＋図 → visual-collision の warn が出ない（出荷テンプレ・Midnight）", () => {
    for (const tpl of [midnight, tech, pitch]) {
      expect(issues(deckOf(TD), tpl).filter((x) => x.id === "visual-collision")).toEqual([]);
    }
  });
  it("図×2 が描ける → figure-dropped は出ない", () => {
    for (const tpl of [midnight, tech, pitch]) {
      expect(issues(deckOf(DD), tpl).filter((x) => x.id === "figure-dropped")).toEqual([]);
    }
  });
  it("図×2 を 1 枠のレイアウトに固定 → 置けない 2 つ目を figure-dropped（info）で告知", () => {
    const d = parseMd(`# 表紙\n\n---\n\n<!-- slide: Content.1Body.Single -->\n# 対象\n\n${DD}\n`);
    const dropped = issues(d, midnight).filter((x) => x.id === "figure-dropped");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ slideIndex: 1, level: "info" });
    expect(dropped[0].message).toContain("図");
  });
});

describe("#392 段 2 (c): round-trip は配置の影響を受けない", () => {
  for (const [name, body] of [["図×2", DD], ["表＋図", TD], ["col 本文｜図", COL]] as const) {
    it(name, () => {
      const md = serializeMd(deckOf(body));
      expect(serializeMd(parseMd(md))).toBe(md);
    });
  }
});

describe("#392 段 2: PPTX — 2 つ目以降のメディア・ネイティブ chart の関係 ID", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const PIE = (l: string) => "```diagram\ntype: pie\ntitle: " + l + "\nnodes:\n  - id: s0\n    label: A\n    value: 3\n  - id: s1\n    label: B\n    value: 1\n```";
  const relsOf = async (zip: JSZip, n: number) => zip.file(`ppt/slides/_rels/slide${n}.xml.rels`)!.async("string");

  it("画像×2 → 1 枚目は従来の rId2、2 枚目は rIdImage2（別のメディアパート）。どちらも <p:pic> で参照", async () => {
    const zip = await JSZip.loadAsync(await generatePptx(deckOf(`![一枚目](${PNG})\n\n![二枚目](${PNG})`), tech));
    const rels = await relsOf(zip, 2);
    expect(rels).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"');
    expect(rels).toContain('Id="rIdImage2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2_2.png"');
    expect(zip.file("ppt/media/image2_2.png")).not.toBeNull();
    const xml = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(xml).toContain('r:embed="rId2"');
    expect(xml).toContain('r:embed="rIdImage2"');
    expect(xml).toContain("二枚目"); // its caption
  });

  it("非ネイティブ Mermaid×2（svgCache あり）→ rId2 と rIdMermaid2、PNG を 2 つ書く", async () => {
    const d = deckOf("```mermaid\ngitGraph\n  commit\n```\n\n```mermaid\ngitGraph\n  commit\n  commit\n```");
    const s = d.slides[1];
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const withSvg = { ...s, mermaidBlock: { ...s.mermaidBlock!, svgCache: svg }, figures: s.figures!.map((f) => (f.kind === "mermaid" ? { ...f, svgCache: svg } : f)) };
    const zip = await JSZip.loadAsync(await generatePptx({ ...d, slides: [d.slides[0], withSvg] }, tech, async () => new Uint8Array([1])));
    const rels = await relsOf(zip, 2);
    expect(rels).toContain('Id="rId2"');
    expect(rels).toContain('Id="rIdMermaid2"');
    expect(zip.file("ppt/media/mermaid2.png")).not.toBeNull();
    expect(zip.file("ppt/media/mermaid2_2.png")).not.toBeNull();
  });

  it("ネイティブ chart×2 → rIdChart と rIdChart2、chart パートも 2 つ（onFigure も 2 回）", async () => {
    const seen: string[] = [];
    const zip = await JSZip.loadAsync(await generatePptx(deckOf(`${PIE("左")}\n\n${PIE("右")}`), midnight, undefined, { charts: "native", onFigure: (k) => seen.push(k) }));
    expect(seen).toEqual(["native", "native"]);
    const rels = await relsOf(zip, 2);
    expect(rels).toMatch(/Id="rIdChart" [^>]*Target="\.\.\/charts\/chart\d+\.xml"/);
    expect(rels).toMatch(/Id="rIdChart2" [^>]*Target="\.\.\/charts\/chart\d+\.xml"/);
    const xml = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(xml).toContain('r:id="rIdChart"');
    expect(xml).toContain('r:id="rIdChart2"');
    expect(Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f))).toHaveLength(2);
  });
});

describe("#392 段 2: <!-- col --> の 図｜図 は columns のまま（Chart にしない＝col が round-trip で残る）", () => {
  it("col 図｜図 → columns 2", () => {
    const s = target(`<!-- col -->\n${DIAG("左")}\n\n<!-- col -->\n${DIAG("右")}`);
    expect(slideRoleRegions(s, 1, 2)).toEqual({ role: "columns", regions: 2, fallback: "Column.2Body.Equal" });
  });
});

describe("#392 段 2: R8 一致 — 描かれる／告知されるが配置と一致する", () => {
  it("visuals.md の全スライド × 3 テンプレ: unboundVisuals に出ないビジュアルはすべて figureRegions で枠を持つ（solo を除く）", async () => {
    const deck = parseMd(readFileSync(resolve(ROOT, "tests/fixtures/slideir-baseline/visuals.md"), "utf8"));
    for (const tpl of [midnight, tech, pitch]) {
      const cat = buildCatalog(tpl);
      deck.slides.forEach((s, i) => {
        const phs = findLayout(tpl, autoSelectLayout(s, i, deck.slides.length, cat))!.placeholders;
        const regions = figureRegions(s, phs);
        const unbound = unboundVisuals(s, phs);
        expect(regions.filter((r) => !r.ph && !(r.solo && r.figure.kind === "diagram")).map((r) => r.ordinal)).toEqual(unbound.map((u) => u.placeholderIdx));
        // ordinal は slideRoleRegions が見る値と同じ（placedFigures 経由）
        expect(regions.map((r) => r.ordinal)).toEqual(placedFigures(s).map((p) => p.ordinal));
      });
    }
  });
});

describe("#392 段 2: col 経路の本文画像も出現順（段 1 の既知の制限＝末尾固定を解消）", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  it("col 画像｜図 → figures は [image, diagram]（画像が先）", () => {
    const s = target(`<!-- col -->\n![左の画像](${PNG})\n\n<!-- col -->\n${DIAG("右")}`);
    expect(s.figures?.map((f) => f.kind)).toEqual(["image", "diagram"]);
  });
  it("画像 → col 図｜図（画像が最初の列より前）→ figures は [image, diagram, diagram]・配置も 1・2・3 の順（PR #657 D2）", () => {
    const s = target(`![前の画像](${PNG})\n\n<!-- col -->\n${DIAG("左")}\n\n<!-- col -->\n${DIAG("右")}`);
    expect(s.figures?.map((f) => f.kind)).toEqual(["image", "diagram", "diagram"]);
    expect(placedFigures(s).map((p) => [p.figure.kind, p.ordinal])).toEqual([["image", "1"], ["diagram", "2"], ["diagram", "3"]]);
  });
  it("col 図｜画像 → [diagram, image]", () => {
    const s = target(`<!-- col -->\n${DIAG("左")}\n\n<!-- col -->\n![右の画像](${PNG})`);
    expect(s.figures?.map((f) => f.kind)).toEqual(["diagram", "image"]);
  });
});
