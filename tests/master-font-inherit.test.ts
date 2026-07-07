/**
 * master-font-inherit.test.ts — regression for "editing the slide master / layout font does nothing on
 * generated slides". Root cause: the filler COPIED the layout placeholder's <a:lstStyle> (hardcoded
 * sz/color) into every SLIDE placeholder, pinning formatting at the slide level so it overrode the
 * layout AND master. Fix: a slide placeholder carries an EMPTY <a:lstStyle/> and inherits font/size/
 * color from the layout (→ master) by type+idx.
 *
 * The gate below is PER-PLACEHOLDER: it scans every <p:sp> that has a <p:ph> and asserts none pins a
 * font. It deliberately EXCLUDES table cells (<a:tbl> inside a <p:graphicFrame>) and diagram nodes
 * (autoshapes with no <p:ph>) — those are independent shapes that legitimately carry their own font and
 * are NOT placeholders, so by design they don't follow the master's body-placeholder formatting.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";
import { parseMd } from "../src/engine/md-parser";

const DIR = resolve(__dirname, "fixtures/templates");

async function slideXml(tpl: TemplateData, md: string, n = 1): Promise<string> {
  const zip = await JSZip.loadAsync(await generatePptx(parseMd(md), tpl));
  return (await zip.file(`ppt/slides/slide${n}.xml`)!.async("string"));
}

/** Every placeholder shape (<p:sp> with <p:ph>) must inherit: an empty <a:lstStyle/>, no <a:defRPr>
 *  inside its lstStyle, and no pinned sz — otherwise the master/layout font edit can't propagate. */
function expectPlaceholdersInherit(xml: string) {
  const phShapes = (xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []).filter((s) => /<p:ph\b/.test(s));
  expect(phShapes.length).toBeGreaterThan(0); // sanity: the slide actually has placeholders
  for (const sp of phShapes) {
    const tx = sp.match(/<p:txBody>[\s\S]*?<\/p:txBody>/)?.[0] ?? "";
    const name = sp.match(/<p:ph\b[^>]*>/)?.[0] ?? "(ph)";
    expect(tx.includes("<a:lstStyle/>"), `${name} should have an empty lstStyle`).toBe(true);
    expect(/<a:lstStyle>[\s\S]*?<a:defRPr/.test(tx), `${name} must not pin a font in its lstStyle`).toBe(false);
  }
}

describe("every generated placeholder inherits font (no slide-level pin) across all fill paths", () => {
  let report: TemplateData;
  let midnight: TemplateData;
  beforeAll(async () => {
    report = await loadTemplate(readFileSync(resolve(DIR, "報告書テンプレート_全レイアウト見本.pptx")));
    midnight = await loadTemplate(readFileSync(resolve(DIR, "Midnight_Executive_30_TemplateOnly.pptx")));
  });

  it("title + meta (Category/Date/Footer)", async () => {
    expectPlaceholdersInherit(await slideXml(report, "<!-- slide: Title.1Title.Single -->\n# 表紙\n## サブ\n\nCategory: 部門X\nDate: 2026\nFooter: 脚注"));
  });

  it("content single body", async () => {
    expectPlaceholdersInherit(await slideXml(report, "<!-- slide: Content.1Body.Single -->\n# 見出し\n\n- 要点A\n- 要点B"));
  });

  it("card group (idx13-21)", async () => {
    // lead with a title slide so the card isn't index-0 (autoSelect's first-slide rule), check slide 2
    expectPlaceholdersInherit(await slideXml(report, "# 表紙\n\n---\n\n# 施策\n\n<!-- card -->\n### A\n- 本文A\n\n<!-- card -->\n### B\n- 本文B\n\n<!-- card -->\n### C\n- 本文C", 2));
  });

  it("step group", async () => {
    expectPlaceholdersInherit(await slideXml(report, "# 表紙\n\n---\n\n# 工程\n\n<!-- step -->\n### S1\n- x\n\n<!-- step -->\n### S2\n- y\n\n<!-- step -->\n### S3\n- z", 2));
  });

  it("kpi group", async () => {
    expectPlaceholdersInherit(await slideXml(report, "<!-- slide: KPI.2Value.Equal -->\n# K\n\n<!-- kpi -->\n- 90%\n\n<!-- kpi -->\n- 80%"));
  });

  it("code block", async () => {
    expectPlaceholdersInherit(await slideXml(report, "# ログ\n\n```\nEventID:4688 プロセス作成\n```"));
  });

  it("table slide (the title placeholder inherits; the <a:tbl> cells are excluded by design)", async () => {
    const xml = await slideXml(report, "# 価格\n\n| 項目 | 値 |\n|---|---|\n| A | 100円 |");
    expectPlaceholdersInherit(xml);
    expect(xml).toContain("<a:tbl>"); // the table renders as a native table (independent of placeholders)
  });

  it("diagram slide (the title placeholder inherits; diagram autoshapes are excluded by design)", async () => {
    expectPlaceholdersInherit(await slideXml(report, "# 構成\n\n```diagram\ntype: flowchart\nnodes:\n  - id: a\n    label: 入力\n  - id: b\n    label: 出力\nedges:\n  - from: a\n    to: b\n```"));
  });

  it("a different master (Midnight) inherits too", async () => {
    expectPlaceholdersInherit(await slideXml(midnight, "<!-- slide: Title.1Title.Single -->\n# Cover"));
    expectPlaceholdersInherit(await slideXml(midnight, "<!-- slide: Content.1Body.Single -->\n# Heading\n\n- point A\n- point B"));
  });
});
