/**
 * image-block.test.ts — an embedded image (![alt](data URI)) is captured into slide.image, routes to a
 * body layout, and EXPORTS into the .pptx as a <p:pic> with the bytes in ppt/media + a slide rel.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";
import { generatePptx } from "../src/engine/placeholder-filler";

const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");
// 1×1 transparent PNG.
const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const IMG_MD = `# 画像スライド\n\n![社内フロー](${IMG})`;

describe("embedded image → PPTX", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(REPORT)); });

  it("embeds the image as a <p:pic> + ppt/media + a slide rel + Content-Type", async () => {
    const deck = parseMd(IMG_MD);
    deck.template = undefined;
    const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
    const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(s1).toContain("<p:pic>");
    expect(s1).toMatch(/<a:blip r:embed="rId2"/); // the pic references the embedded image
    expect(zip.file("ppt/media/image1.png")).not.toBeNull(); // …whose bytes are in the package
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(rels).toMatch(/Id="rId2"[^>]*Target="\.\.\/media\/image1\.png"/);
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toMatch(/Extension="png"/);
  });

  it("a non-data (path) src is skipped — no dangling rId/pic", async () => {
    const deck = parseMd("# T\n\n![](assets/x.png)");
    deck.template = undefined;
    const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
    const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(s1).not.toContain("<p:pic>"); // path src isn't embeddable → no picture emitted
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(rels).not.toMatch(/Id="rId2"/);
  });
});
