/**
 * section-fallback-637.test.ts — #637 `<!-- section -->` の章扉が、`SectionNav.1TitleList.Single`（章一覧つき
 * 章扉）を持たないテンプレで書き出し時に本文レイアウトへ落ちる不具合。
 *
 * 原因: materializeDerivedSlides が章扉を無条件に `SectionNav.1TitleList.Single` へ固定し idx 1 に章一覧を
 * 足していた。このレイアウトが無いテンプレでは autoSelectLayout が固定を degrade し（タイトル＋本文＝content 役）、
 * 本文レイアウトに章一覧が入った。選択（未 materialize のスライドに autoSelectLayout）と書き出しが食い違う。
 *
 * 受け入れ基準（Issue 本文）: 出荷 3 本で章扉を書き出すと slide → layout が章扉系（section 役）になる。
 * 不変条件: このレイアウトを持つテンプレ（Executive・Midnight TemplateOnly）の出力は byte-identical（golden。
 * digest は修正前の main c3536d7 で記録）。加えて committed corpus の全マスターで「選択＝書き出し」（R8）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import { loadTemplate, autoSelectLayout } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { materializeDerivedSlides } from "../src/engine/deck-sections";
import { parseMd } from "../src/engine/md-parser";
import { generatePptx } from "../src/engine/placeholder-filler";

const SHIPPED_DIR = resolve(__dirname, "../public/templates/slide");
const FIXTURE_DIR = resolve(__dirname, "fixtures/templates");
const REPRO = "# 表紙\n\n---\n\n<!-- section -->\n# 第1章\n\n---\n\n# 本文\n\n- a";
// golden 用: 章扉 2 つ＋live 目次（章一覧の導出経路をすべて通す）。
const GOLDEN_MD = "# 表紙\n\n---\n\n<!-- section -->\n# 第1章\n\n---\n\n# 本文\n\n- a\n\n---\n\n<!-- section -->\n# 第2章\n\n---\n\n<!-- toc -->";

const load = async (path: string) => loadTemplate(readFileSync(path));

/** 書き出した PPTX のスライド n（1 始まり）が使ったレイアウト名と、スライド XML。 */
async function exportedSlide(pptx: Uint8Array, n: number): Promise<{ layout: string; xml: string }> {
  const z = await JSZip.loadAsync(pptx);
  const rel = await z.file(`ppt/slides/_rels/slide${n}.xml.rels`)!.async("string");
  const file = rel.match(/slideLayouts\/(slideLayout\d+\.xml)/)![1];
  const layout = (await z.file(`ppt/slideLayouts/${file}`)!.async("string")).match(/<p:cSld name="([^"]*)"/)![1];
  return { layout, xml: await z.file(`ppt/slides/slide${n}.xml`)!.async("string") };
}

/** 中身の指紋: 全パートの名前＋内容（zip のエントリ日時は含めない）。executive-preset-596 と同じ定義。 */
async function contentDigest(bytes: Uint8Array): Promise<string> {
  const z = await JSZip.loadAsync(bytes);
  const h = createHash("sha256");
  for (const n of Object.keys(z.files).sort()) {
    if (z.files[n].dir) continue;
    h.update(n + "\0");
    h.update(await z.files[n].async("uint8array"));
    h.update("\0");
  }
  return h.digest("hex");
}

describe("#637 受け入れ基準: 出荷 3 本の章扉は書き出しでも章扉レイアウト（section 役）に入る", () => {
  for (const file of [
    "技術報告_スタンダード水色_TemplateOnly.pptx",
    "配布資料_公文書高密度_TemplateOnly.pptx",
    "ビジュアルデッキ_マガジン_TemplateOnly.pptx",
  ]) {
    it(file, async () => {
      const tpl = await load(resolve(SHIPPED_DIR, file));
      const catalog = buildCatalog(tpl);
      const { layout, xml } = await exportedSlide(await generatePptx(parseMd(REPRO), tpl), 2);
      expect(catalog.find((e) => e.name === layout)?.role).toBe("section");
      expect(layout).toBe("01_章扉");
      // 章一覧（「1. 第1章」）は注入しない — 01_章扉 の idx 1 は 1 行・数文字の章番号枠で、一覧の器ではない。
      expect(xml).not.toContain("1. 第1章");
      expect(xml).toContain("第1章");
    });
  }
});

describe("#637 不変条件: SectionNav.1TitleList.Single を持つテンプレの出力は byte-identical（golden）", () => {
  const GOLDEN: Record<string, string> = {
    [resolve(SHIPPED_DIR, "エグゼクティブ_Executive_TemplateOnly.pptx")]:
      "ba781909e7e8ca6463049ba975f40b4dc76b218918f6939872896dcfc609cb24",
    [resolve(FIXTURE_DIR, "Midnight_Executive_30_TemplateOnly.pptx")]:
      "5221b4d2fb0be57d37b29966a9fc06a5696c458f754dbf75be8253995e9e35b6",
  };
  for (const [path, digest] of Object.entries(GOLDEN)) {
    it(path.split("/").pop()!, async () => {
      const tpl = await load(path);
      const pptx = await generatePptx(parseMd(GOLDEN_MD), tpl);
      expect(await contentDigest(pptx)).toBe(digest);
      expect((await exportedSlide(pptx, 2)).layout).toBe("SectionNav.1TitleList.Single");
    });
  }
});

describe("#637 R8: committed corpus の全マスターで、章扉の選択（未 materialize）と書き出しが一致する", () => {
  for (const dir of [FIXTURE_DIR, SHIPPED_DIR]) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".pptx")).sort()) {
      it(file, async () => {
        const tpl = await load(resolve(dir, file));
        const catalog = buildCatalog(tpl);
        const hasNavList = catalog.some((e) => e.name === "SectionNav.1TitleList.Single");
        const deck = parseMd(REPRO);
        const picked = autoSelectLayout(deck.slides[1], 1, deck.slides.length, catalog);
        const materialized = materializeDerivedSlides(deck, catalog);
        const viaMaterialize = autoSelectLayout(materialized.slides[1], 1, deck.slides.length, catalog);
        const exported = (await exportedSlide(await generatePptx(deck, tpl), 2)).layout;
        // 書き出し・プレビュー（どちらも materialize(deck, catalog) → autoSelectLayout）は同じレイアウトを描く。
        expect(exported).toBe(viaMaterialize);
        // 章一覧つき章扉が無いテンプレでは、選択だけを見た結果とも一致する（固定も注入もしない）。
        if (!hasNavList) {
          expect(materialized.slides[1]).toEqual(deck.slides[1]);
          expect(exported).toBe(picked);
        } else {
          expect(exported).toBe("SectionNav.1TitleList.Single");
        }
      });
    }
  }
});

describe("#637 catalog を渡さない呼び出し（テンプレ無し・md 往復）は従来どおり", () => {
  it("catalog 省略時は SectionNav.1TitleList.Single に固定して章一覧を注入する", () => {
    const slide = materializeDerivedSlides(parseMd(REPRO)).slides[1];
    expect(slide.layout).toBe("SectionNav.1TitleList.Single");
    expect(slide.placeholders.some((p) => p.idx === "1")).toBe(true);
  });
});
