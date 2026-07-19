/**
 * section-footer.test.tsx — #168: フッタ章名の伝播（案A・chrome 経路・設計確定 2026-07-19）。
 *
 * 章名フッタは meta/binding 経路に乗らず、描画/出力時に注入する chrome（sldNum と同じ扱い）:
 *   - section タグを使うデッキで既定 ON、追加記法なし
 *   - レイアウトが ftr（footer）プレースホルダを持つスライドにのみ注入。枠が無ければ黙ってスキップ
 *     （unbound 警告は出さない — binding 経路を通らないため ADR-0030 と衝突しない）
 *   - 明示 Footer: meta が束縛されるスライド（title/closing 系）には自動注入しない（明示優先）
 *   - 章扉より前のスライドには入らない（scanSections の該当エントリなし＝sectionFooterFor が null）
 *   - 自動フッタは md へ一切書き戻さない（DeckIR に複製状態を持たない）
 *   - PPTX（placeholder-filler.buildSlideXml）・HTML/プレビュー（SlideCard）が同じ
 *     sectionFooterFor 導出関数を通る（R8 — 意味の重複禁止）
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMd } from "../src/engine/md-parser";
import { sectionFooterFor } from "../src/engine/deck-sections";
import { generatePptx } from "../src/engine/placeholder-filler";
import {
  loadTemplate,
  findLayout,
  autoSelectLayout,
  type TemplateData,
  type PlaceholderInfo,
} from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { SlideCard } from "../src/components/SlidePreview";
import type { DeckIR } from "../src/engine/slide-schema";

const TEMPLATE_PATH = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

let tpl: TemplateData;
beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(TEMPLATE_PATH));
});

// 章2つ＋各章に content スライド（Content.1Body.Single に明示ピン）。章扉より前に1枚 content を
// 置いて「章扉より前は注入なし」を検証できるようにする。
// slides: 0=準備(章扉前) 1=現状分析(章扉) 2=詳細A 3=解決策(章扉) 4=詳細B
const MD = `<!-- slide: Content.1Body.Single -->
# 準備

- 事前情報

---

<!-- section -->
# 現状分析

> 補足説明

---

<!-- slide: Content.1Body.Single -->
# 詳細スライドA

- 内容A

---

<!-- section -->
# 解決策

---

<!-- slide: Content.1Body.Single -->
# 詳細スライドB

- 内容B
`;

// Content.1Body.Single には ftr（footer）プレースホルダが無い（canonical テンプレの実仕様）。
// PPTX/preview 消費点のテストでは、テンプレを COPY してこの合成 ftr 枠を1つ足したものを使う
// （placeholder-binding-direct.test.ts の mkPh 方式を踏襲。物理 zip のレイアウト XML は触らない —
// buildSlideXml / SlideCard は layout.placeholders という JS 配列だけを見て組み立てる）。
function withFooterPlaceholder(t: TemplateData, layoutName: string): TemplateData {
  const ftr: PlaceholderInfo = {
    idx: "90",
    type: "ftr",
    name: "Footer Placeholder",
    shapeXml:
      `<p:sp><p:nvSpPr><p:cNvPr id="77" name="Footer Placeholder"/></p:nvSpPr>` +
      `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>x</a:t></a:r></a:p></p:txBody></p:sp>`,
    style: { x: 0.5, y: 7.05, w: 4, h: 0.3, fontSize: 10, fontColor: "94A3B8", fontName: "Calibri", bold: false, align: "l", bulletChar: "" },
  };
  return {
    ...t,
    layouts: t.layouts.map((l) => (l.name === layoutName ? { ...l, placeholders: [...l.placeholders, ftr] } : l)),
  };
}

async function slideXml(buf: Uint8Array, slideNum: number): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  return zip.file(`ppt/slides/slide${slideNum}.xml`)!.async("string");
}

// ── 純関数（deck-sections.sectionFooterFor） ──

describe("sectionFooterFor — 純関数（deck-sections, #168）", () => {
  it("章扉より前のスライドは null（注入なし）", () => {
    const deck = parseMd(MD);
    expect(sectionFooterFor(deck, 0)).toBeNull();
  });

  it("章扉スライド自身と、それ以降の content スライドは所属章名を返す", () => {
    const deck = parseMd(MD);
    expect(sectionFooterFor(deck, 1)).toBe("現状分析");
    expect(sectionFooterFor(deck, 2)).toBe("現状分析");
    expect(sectionFooterFor(deck, 3)).toBe("解決策");
    expect(sectionFooterFor(deck, 4)).toBe("解決策");
  });

  it("章名（# 見出し）の変更が再導出で追随する", () => {
    const deck = parseMd(MD);
    const renamed: DeckIR = {
      ...deck,
      slides: deck.slides.map((s, i) =>
        i === 1
          ? {
              ...s,
              placeholders: s.placeholders.map((p) =>
                p.idx === "15" ? { ...p, paragraphs: [{ segments: [{ text: "現状と課題" }] }] } : p,
              ),
            }
          : s,
      ),
    };
    expect(sectionFooterFor(renamed, 2)).toBe("現状と課題");
    expect(sectionFooterFor(renamed, 4)).toBe("解決策"); // 別章は不変
  });

  it("section タグ無しデッキは常に null", () => {
    const deck = parseMd("# T\n\n- a\n\n---\n\n# U\n\n- b");
    expect(sectionFooterFor(deck, 0)).toBeNull();
    expect(sectionFooterFor(deck, 1)).toBeNull();
  });
});

// ── PPTX 消費点（placeholder-filler.buildSlideXml） ──

describe("generatePptx — ftr 枠への章名フッタ注入 (#168)", () => {
  it("ftr 枠を持つレイアウトの content スライドに所属章名が入る", async () => {
    const t = withFooterPlaceholder(tpl, "Content.1Body.Single");
    const buf = await generatePptx(parseMd(MD), t);
    expect(await slideXml(buf, 3)).toContain("現状分析"); // 詳細スライドA = index2 → slide3
    expect(await slideXml(buf, 5)).toContain("解決策"); // 詳細スライドB = index4 → slide5
  });

  it("章扉より前のスライドには入らない", async () => {
    const t = withFooterPlaceholder(tpl, "Content.1Body.Single");
    const buf = await generatePptx(parseMd(MD), t);
    const s1 = await slideXml(buf, 1); // 準備 = index0（章扉より前）
    expect(s1).not.toContain("現状分析");
    expect(s1).not.toContain("解決策");
  });

  it("ftr 枠の無いレイアウトは警告なしでスキップされる", async () => {
    // 実テンプレ（未加工）— Content.1Body.Single には ftr 枠が無い
    const buf = await generatePptx(parseMd(MD), tpl);
    const s3 = await slideXml(buf, 3);
    expect(s3).not.toContain("現状分析");
  });

  it("章名変更が全スライドのフッタに追随する", async () => {
    const t = withFooterPlaceholder(tpl, "Content.1Body.Single");
    const deck = parseMd(MD);
    const renamed: DeckIR = {
      ...deck,
      slides: deck.slides.map((s, i) =>
        i === 1
          ? {
              ...s,
              placeholders: s.placeholders.map((p) =>
                p.idx === "15" ? { ...p, paragraphs: [{ segments: [{ text: "現状と課題" }] }] } : p,
              ),
            }
          : s,
      ),
    };
    const buf = await generatePptx(renamed, t);
    const s3 = await slideXml(buf, 3);
    expect(s3).toContain("現状と課題");
    expect(s3).not.toContain("現状分析");
  });

  it("section 無しデッキは ftr 枠があっても注入されない（既存出力を変えない＝byte-identical）", async () => {
    const deck = parseMd("<!-- slide: Content.1Body.Single -->\n# T\n\n- body");
    const bufBase = await generatePptx(deck, tpl);
    const bufFtr = await generatePptx(deck, withFooterPlaceholder(tpl, "Content.1Body.Single"));
    expect(await slideXml(bufFtr, 1)).toBe(await slideXml(bufBase, 1));
  });

  it("明示 Footer: が束縛されるスライドには自動注入しない（明示優先）", async () => {
    const deck: DeckIR = {
      slides: [
        {
          layout: "Content.1Body.Single",
          sectionBreak: true,
          placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "現状分析" }] }] }],
        },
        {
          layout: "Title.1Title.Single", // 実テンプレの idx=12 が本物の footer 枠（明示 Footer: の束縛先）
          placeholders: [
            { idx: "0", paragraphs: [{ segments: [{ text: "クロージング" }] }] },
            { idx: "12", paragraphs: [{ segments: [{ text: "手動フッタ" }] }] },
          ],
        },
      ],
    };
    const buf = await generatePptx(deck, tpl);
    const s2 = await slideXml(buf, 2);
    expect(s2).toContain("手動フッタ");
    expect(s2).not.toContain("現状分析");
  });
});

// ── HTML/プレビューの SSR 消費点（SlideCard — R8: PPTX と同じ導出関数を通る） ──

describe("SlideCard — 章名フッタの SSR 描画 (#168)", () => {
  it("ftr 枠を持つレイアウトで SlideCard にも章名フッタが SSR される", async () => {
    const t = withFooterPlaceholder(tpl, "Content.1Body.Single");
    const cat = buildCatalog(t);
    const deck = parseMd(MD);
    const i = 2; // 詳細スライドA
    const slide = deck.slides[i];
    const layout = findLayout(t, autoSelectLayout(slide, i, deck.slides.length, cat));
    const html = renderToStaticMarkup(
      <SlideCard
        slide={slide}
        slideIndex={i}
        totalSlides={deck.slides.length}
        layout={layout}
        masterBgColor={t.masterBgColor}
        masterDecorations={t.masterDecorations}
        masterStaticTexts={t.masterStaticTexts}
        scale={96}
        sectionFooterText={sectionFooterFor(deck, i)}
        exportMode
      />,
    );
    expect(html).toContain("現状分析");
  });

  it("章扉より前のスライドには SSR でも入らない", async () => {
    const t = withFooterPlaceholder(tpl, "Content.1Body.Single");
    const cat = buildCatalog(t);
    const deck = parseMd(MD);
    const i = 0; // 準備（章扉より前）
    const slide = deck.slides[i];
    const layout = findLayout(t, autoSelectLayout(slide, i, deck.slides.length, cat));
    const html = renderToStaticMarkup(
      <SlideCard
        slide={slide}
        slideIndex={i}
        totalSlides={deck.slides.length}
        layout={layout}
        masterBgColor={t.masterBgColor}
        masterDecorations={t.masterDecorations}
        masterStaticTexts={t.masterStaticTexts}
        scale={96}
        sectionFooterText={sectionFooterFor(deck, i)}
        exportMode
      />,
    );
    expect(html).not.toContain("現状分析");
  });
});
