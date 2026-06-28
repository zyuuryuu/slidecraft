/**
 * project-io.test.ts — a `.slidecraft` bundle round-trips the full editing state
 * (deck + template) losslessly: bundle → open → same deck, working template.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { bundleProject, openProject } from "../src/engine/project-io";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";

let template: TemplateData;
beforeAll(async () => {
  template = await loadTemplate(readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx")));
});

describe("project-io (.slidecraft bundle)", () => {
  const DECK_MD = "# 表紙\n\n## サブ\n\n---\n\n# 中身\n\n- 速度: 0.8秒\n- 重量: 1.2kg";

  it("bundle → open restores the SAME deck (lossless, not via Markdown)", async () => {
    const deck = parseMd(DECK_MD);
    const bytes = await bundleProject(deck, template, { templateName: "Midnight Executive", savedAt: "2026-06-25T00:00:00Z" });
    const opened = await openProject(bytes);
    expect(opened.deck).toEqual(deck); // DeckIR round-trips byte-for-byte through JSON
    expect(opened.meta.templateName).toBe("Midnight Executive");
    expect(opened.meta.version).toBe(1);
  });

  it("restores a WORKING template (layouts re-parse from the bundled .pptx)", async () => {
    const deck = parseMd(DECK_MD);
    const opened = await openProject(await bundleProject(deck, template, { templateName: "T", savedAt: "x" }));
    expect(opened.template.layouts.length).toBe(template.layouts.length);
    expect(opened.template.layouts.length).toBeGreaterThan(0);
  });

  it("rejects a malformed bundle (missing deck.json / template.pptx)", async () => {
    const JSZip = (await import("jszip")).default;
    const empty = await new JSZip().generateAsync({ type: "uint8array" });
    await expect(openProject(empty)).rejects.toThrow(/slidecraft/);
  });
});
