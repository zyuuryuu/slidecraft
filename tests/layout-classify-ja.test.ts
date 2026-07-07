/**
 * layout-classify-ja.test.ts — classifyLayout must recognize JAPANESE layout names, not just English.
 * Regression: a Japanese cover 「00_表紙」 (title + a meta body) fell through the English-only keywords
 * to STRUCTURE, which classified it "content"; then every content slide picked the first content
 * layout — the cover — so the whole deck rendered as the title slide.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { classifyLayout, buildCatalog } from "../src/engine/template-catalog";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";

const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");
const info = { hasTitle: true, hasSubtitle: false, bodyCount: 1 };

describe("classifyLayout recognizes Japanese role keywords", () => {
  it("表紙 → title, 章扉 → section, まとめ → closing", () => {
    expect(classifyLayout("00_表紙", info)).toBe("title");
    expect(classifyLayout("01_章扉", info)).toBe("section");
    expect(classifyLayout("06_まとめ", info)).toBe("closing");
  });

  it("本文（Nカラム） stays structure-driven (word カラム doesn't force columns)", () => {
    expect(classifyLayout("02_本文（1カラム）", { ...info, bodyCount: 1 })).toBe("content");
    expect(classifyLayout("03_本文（2カラム）", { ...info, bodyCount: 2 })).toBe("columns");
  });
});

describe("content slides no longer all collapse onto the cover", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(REPORT)); });

  it("a content slide picks a real content layout, NOT 00_表紙", () => {
    const cat = buildCatalog(tpl);
    const content = parseMd("# 本日のアジェンダ\n\n- A\n- B\n- C").slides[0];
    const picked = autoSelectLayout(content, 1, 5, cat);
    expect(picked).not.toBe("00_表紙");
    expect(cat.find((e) => e.name === picked)?.role).toBe("content");
  });
});
