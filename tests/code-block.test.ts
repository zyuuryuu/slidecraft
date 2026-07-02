/**
 * code-block.test.ts — a fenced code/log block (```yaml / ```python / ```log …, i.e. NOT
 * diagram/mermaid) must be CAPTURED (was silently dropped by the parser) and routed to a code
 * layout (07_コード／ログ), with the code text present in the exported slide.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { generatePptx } from "../src/engine/placeholder-filler";

const REPORT = resolve(__dirname, "../public/templates/slide/報告書テンプレート_全レイアウト見本.pptx");
const MD = "# 検知ルールの実装例\n> Sigma 形式\n\n```yaml\ndetection:\n  selection:\n    EventID: 4688\n  condition: selection\n```";

describe("fenced code/log block", () => {
  it("is CAPTURED into slide.code (not dropped) with its language", () => {
    const s = parseMd(MD).slides[0];
    expect(s.code?.content).toContain("EventID: 4688");
    expect(s.code?.content).toContain("condition: selection");
    expect(s.code?.lang).toBe("yaml");
    // it is NOT mistaken for a diagram/mermaid figure
    expect(s.diagram).toBeUndefined();
    expect(s.mermaidBlock).toBeUndefined();
  });

  it("round-trips through the Markdown serializer (code survives)", () => {
    const s2 = parseMd(serializeMd(parseMd(MD))).slides[0];
    expect(s2.code?.content).toContain("EventID: 4688");
    expect(s2.code?.lang).toBe("yaml");
  });

  describe("on the 報告書 template", () => {
    let tpl: TemplateData;
    beforeAll(async () => { tpl = await loadTemplate(readFileSync(REPORT)); });

    it("routes to the 07_コード／ログ layout", () => {
      const cat = buildCatalog(tpl);
      const s = parseMd(MD).slides[0];
      expect(autoSelectLayout(s, 1, 3, cat)).toBe("07_コード／ログ");
    });

    it("exports the code text into the slide", async () => {
      const deck = parseMd(MD);
      deck.template = undefined;
      const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
      const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
      expect(s1).toContain("EventID: 4688");
      expect(s1).toContain("condition: selection");
    });
  });
});
