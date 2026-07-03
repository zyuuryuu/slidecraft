/**
 * master-font-inherit.test.ts — regression for the "editing the slide master / layout font does nothing
 * on generated slides" bug. Root cause: the filler COPIED the layout placeholder's <a:lstStyle> (with a
 * hardcoded sz/color) into every SLIDE placeholder, pinning the formatting at the slide level so it
 * overrode the layout AND master. A slide placeholder must instead carry an EMPTY <a:lstStyle/> and
 * inherit font/size/color from the layout (→ master) by type+idx — the idiomatic OOXML structure.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";
import { parseMd } from "../src/engine/md-parser";

const DIR = resolve(__dirname, "../public/templates/slide");

async function slideXml(tpl: TemplateData, md: string): Promise<string> {
  const zip = await JSZip.loadAsync(await generatePptx(parseMd(md), tpl));
  return zip.file("ppt/slides/slide1.xml")!.async("string");
}

describe("generated slide placeholders inherit font from the layout/master (no slide-level pin)", () => {
  let report: TemplateData;
  let midnight: TemplateData;
  beforeAll(async () => {
    report = await loadTemplate(readFileSync(resolve(DIR, "報告書テンプレート_全レイアウト見本.pptx")));
    midnight = await loadTemplate(readFileSync(resolve(DIR, "Midnight_Executive_30_TemplateOnly.pptx")));
  });

  it("a title slide's placeholders carry no hardcoded font size (they inherit)", async () => {
    const s1 = await slideXml(report, "<!-- slide: Title.1Title.Single -->\n# 表紙タイトル\n## サブ");
    expect(s1).toContain("表紙タイトル"); // text present
    // the slide's lstStyle must be empty — no <a:defRPr sz="..."> pinned onto the slide
    expect(/<a:lstStyle>[\s\S]*?sz="/.test(s1)).toBe(false);
    expect(s1).toContain("<a:lstStyle/>"); // empty lstStyle → inherits
  });

  it("a content slide's body inherits too (no slide-level sz/color)", async () => {
    const s1 = await slideXml(report, "<!-- slide: Content.1Body.Single -->\n# 見出し\n\n- 要点A\n- 要点B");
    expect(s1).toContain("要点A");
    expect(/<a:lstStyle>[\s\S]*?sz="/.test(s1)).toBe(false);
  });

  it("holds on a different master too (Midnight)", async () => {
    const s1 = await slideXml(midnight, "<!-- slide: Title.1Title.Single -->\n# Cover");
    expect(s1).toContain("Cover");
    expect(/<a:lstStyle>[\s\S]*?sz="/.test(s1)).toBe(false);
  });
});
