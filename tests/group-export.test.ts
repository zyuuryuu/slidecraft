/**
 * group-export.test.ts — S5. The export (and preview, sharing the same contentFor) must FILL a grouped
 * layout via expandGroups: a card slide's heading goes to the HEADING placeholder and its body to the
 * BODY placeholder — two DIFFERENT shapes. (Without the group path, bindContentByRole would merge the
 * whole group into one body cell.) Also verifies the card layout is selected.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { generatePptx } from "../src/engine/placeholder-filler";

const REPORT = resolve(__dirname, "../public/templates/slide/報告書テンプレート_全レイアウト見本.pptx");
const CARD_MD = `# 表紙

---

# アーキテクチャ構成

<!-- card -->
### 収集層
eBPFで可視化

<!-- card -->
### 分析層
SIEMへ集約

<!-- card -->
### 運用
Sigmaで管理`;

/** the <p:sp> whose text contains `needle`, or "". */
function shapeWith(xml: string, needle: string): string {
  for (const sp of xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) if (sp.includes(needle)) return sp;
  return "";
}

describe("grouped-layout export (S5)", () => {
  let tpl: TemplateData;
  let cat: LayoutCatalog;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(REPORT)); cat = buildCatalog(tpl); });

  it("the card slide selects 10_カード3列", () => {
    const deck = parseMd(CARD_MD);
    expect(autoSelectLayout(deck.slides[1], 1, deck.slides.length, cat)).toBe("10_カード3列");
  });

  it("export puts each group's heading and body in DIFFERENT placeholders (expandGroups, not merged)", async () => {
    const deck = parseMd(CARD_MD);
    deck.template = undefined;
    const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
    const s2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(s2).toContain("収集層");
    expect(s2).toContain("eBPFで可視化");
    // the heading shape must NOT also contain the body → they are separate placeholders (card 見出し vs 説明)
    expect(shapeWith(s2, "収集層")).not.toContain("eBPFで可視化");
    // all three cards' headings landed
    expect(s2).toContain("分析層");
    expect(s2).toContain("運用");
  });
});
