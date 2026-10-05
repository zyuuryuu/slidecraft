/**
 * image-aspect-wysiwyg.test.tsx — Issue #417: an image WITHOUT `{ar=…}` used to be STRETCHED to its box
 * in the PPTX (fitImageInBox had no aspect → `<a:stretch>` fills the pic rect) while the preview
 * letterboxed it (`object-fit: contain` knows the real pixel size). Both now go through ONE aspect
 * resolver (resolvedImageAspect: `ar` → the image's own header size → unknown), R8:
 *   - readable size → both letterbox (the preview's behavior was the correct one);
 *   - unreadable (SVG …) → both stretch (export unchanged; preview `object-fit: fill`);
 *   - `ar` given → unchanged (PPTX byte-identical, preview markup identical).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { deflateSync, crc32 } from "zlib";
import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMd } from "../src/engine/md-parser";
import { generatePptx } from "../src/engine/placeholder-filler";
import { loadTemplate, findLayout, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { imagePlaceholder, imageRect, resolvedImageAspect } from "../src/engine/visual-placement";
import { SlideCard } from "../src/components/SlidePreview";

const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");

/** A real (decodable) RGBA PNG of w×h — the bytes LibreOffice/PowerPoint would render. */
function pngDataUri(w: number, h: number): string {
  const chunk = (type: string, data: Buffer) => {
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h); // filter byte 0 + transparent pixels per row
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
const PNG_800x500 = pngDataUri(800, 500);
const SVG = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>").toString("base64")}`;

let tpl: TemplateData;
beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(REPORT));
});

async function slideXml(md: string): Promise<string> {
  const deck = parseMd(md);
  deck.template = undefined;
  const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
  return zip.file("ppt/slides/slide1.xml")!.async("string");
}
function picXfrm(xml: string) {
  const m = xml.match(/name="Image"[\s\S]*?<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/)!;
  return { x: +m[1], y: +m[2], cx: +m[3], cy: +m[4] };
}
/** The slide's image box (inches) — the same resolution SlidePreview / generatePptx use. */
function imageBox(md: string) {
  const deck = parseMd(md);
  const slide = deck.slides[0];
  const layout = findLayout(tpl, autoSelectLayout(slide, 0, deck.slides.length, buildCatalog(tpl)))!;
  return { slide, layout, box: imageRect(slide.image!, imagePlaceholder(layout.placeholders, slide.image!.placeholderIdx))! };
}
function previewImgStyle(md: string): string {
  const { slide, layout } = imageBox(md);
  const html = renderToStaticMarkup(
    <SlideCard slide={slide} slideIndex={0} totalSlides={1} layout={layout} masterBgColor={tpl.masterBgColor} scale={96} exportMode />,
  );
  return html.match(/<img src="data:image\/(?:png|svg\+xml)[^"]*"[^>]*style="([^"]*)"/)![1];
}
const E = (n: number) => Math.round(n * 914400);

describe("ar-less image: export letterboxes like the preview (#417)", () => {
  const md = `# 画像\n\n![](${PNG_800x500})`;

  it("the resolver reads the 800×500 header → aspect 1.6", () => {
    expect(resolvedImageAspect(parseMd(md).slides[0].image!)).toBeCloseTo(1.6, 9);
  });

  it("PPTX <p:pic> cx/cy ratio is 1.6 (±1%), not the box's", async () => {
    const { box } = imageBox(md);
    expect(Math.abs(box.w / box.h - 1.6)).toBeGreaterThan(0.016); // the box itself is NOT 1.6 — else the test proves nothing
    const pic = picXfrm(await slideXml(md));
    expect(Math.abs(pic.cx / pic.cy / 1.6 - 1)).toBeLessThanOrEqual(0.01);
  });

  it("R8 agreement: the PPTX pic rect == CSS `object-fit: contain` of an 800×500 image in the preview box", async () => {
    const { box } = imageBox(md);
    // CSS Images 3 §5.5 contain: scale = min(boxW/natW, boxH/natH), centered in the box.
    const s = Math.min(box.w / 800, box.h / 500);
    const w = 800 * s, h = 500 * s;
    const css = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
    const pic = picXfrm(await slideXml(md));
    expect(pic).toEqual({ x: E(css.x), y: E(css.y), cx: E(css.w), cy: E(css.h) });
    expect(previewImgStyle(md)).toContain("object-fit:contain");
  });

  it("`ar` still wins over the header (ar=2 on an 800×500 PNG → 2.0)", async () => {
    const pic = picXfrm(await slideXml(`# 画像\n\n![](${PNG_800x500}){ar=2}`));
    expect(Math.abs(pic.cx / pic.cy / 2 - 1)).toBeLessThanOrEqual(0.01);
  });

  it("unreadable size (SVG, no ar) → export stretches to the box AND the preview stretches too (fill)", async () => {
    const svgMd = `# 画像\n\n![](${SVG})`;
    const { box } = imageBox(svgMd);
    expect(picXfrm(await slideXml(svgMd))).toEqual({ x: E(box.x), y: E(box.y), cx: E(box.w), cy: E(box.h) });
    expect(previewImgStyle(svgMd)).toContain("object-fit:fill");
  });

  it("preview object-fit for `ar`-given images is unchanged (contain / cover)", () => {
    expect(previewImgStyle(`# 画像\n\n![](${PNG_800x500}){ar=1.6}`)).toContain("object-fit:contain");
    expect(previewImgStyle(`# 画像\n\n![](${PNG_800x500}){fit=cover,ar=1.6}`)).toContain("object-fit:cover");
  });
});
