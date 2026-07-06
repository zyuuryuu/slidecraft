/**
 * image-geometry.test.ts — 案B: an image can carry a manual size/position override (rect, inches) +
 * fit (contain/cover) + intrinsic aspect. Round-trips through Markdown via a `{…}` attr suffix, the
 * shared imageRect resolver falls back to the placeholder box, and the PPTX <p:pic> honors the rect
 * (and crops via <a:srcRect> for cover). WYSIWYG: preview objectFit + PPTX geometry agree.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { imageRect, imageAspectRatio, dragImageRect } from "../src/engine/placeholder-binding";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";

const REPORT = resolve(__dirname, "../public/templates/slide/報告書テンプレート_全レイアウト見本.pptx");
const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const EMU = (n: number) => Math.round(n * 914400);

describe("案B: image geometry override — Markdown round-trip", () => {
  it("parses a {x,y,w,h,fit,ar} suffix into rect/fit/aspect", () => {
    const deck = parseMd(`# T\n\n![社内図](${IMG}){x=2.1,y=1.4,w=4,h=3,fit=cover,ar=1.5}`);
    const img = deck.slides[0].image!;
    expect(img.rect).toEqual({ x: 2.1, y: 1.4, w: 4, h: 3 });
    expect(img.fit).toBe("cover");
    expect(img.aspect).toBe(1.5);
    expect(img.alt).toBe("社内図");
  });

  it("a plain image has NO rect/fit/aspect (backward compatible)", () => {
    const img = parseMd(`# T\n\n![](${IMG})`).slides[0].image!;
    expect(img.rect).toBeUndefined();
    expect(img.fit).toBeUndefined();
    expect(img.aspect).toBeUndefined();
  });

  it("round-trips rect+fit+aspect losslessly through serialize→parse", () => {
    const md = `# T\n\n![社内図](${IMG}){x=2.1,y=1.4,w=4,h=3,fit=cover,ar=1.5}`;
    const back = parseMd(serializeMd(parseMd(md))).slides[0].image!;
    expect(back.rect).toEqual({ x: 2.1, y: 1.4, w: 4, h: 3 });
    expect(back.fit).toBe("cover");
    expect(back.aspect).toBe(1.5);
  });

  it("serializes a plain image WITHOUT a {…} suffix (no pollution)", () => {
    const md = serializeMd(parseMd(`# T\n\n![x](${IMG})`));
    expect(md).toContain(`![x](${IMG})`);
    expect(md).not.toMatch(/\}\s*$/m);
  });
});

describe("案B: imageRect resolver", () => {
  const ph = { idx: "1", type: "body", name: "Body", shapeXml: "", style: { x: 1, y: 1, w: 5, h: 4 } } as never;
  it("returns the manual rect when present", () => {
    expect(imageRect({ src: IMG, alt: "", placeholderIdx: "1", rect: { x: 2, y: 3, w: 6, h: 2 } }, ph))
      .toEqual({ x: 2, y: 3, w: 6, h: 2 });
  });
  it("falls back to the placeholder box when no rect", () => {
    expect(imageRect({ src: IMG, alt: "", placeholderIdx: "1" }, ph)).toEqual({ x: 1, y: 1, w: 5, h: 4 });
  });
  it("is undefined when neither rect nor placeholder is available", () => {
    expect(imageRect({ src: IMG, alt: "", placeholderIdx: "1" }, undefined)).toBeUndefined();
  });
});

describe("案B: imageAspectRatio (one fallback, shared by preview drag + form so they agree)", () => {
  const img = (aspect?: number) => ({ src: IMG, alt: "", placeholderIdx: "1", ...(aspect ? { aspect } : {}) });
  it("uses the measured intrinsic aspect when present", () => {
    expect(imageAspectRatio(img(1.5), { x: 0, y: 0, w: 5, h: 4 })).toBe(1.5);
  });
  it("falls back to the box aspect (NOT a hardcoded 1) when no measured aspect", () => {
    expect(imageAspectRatio(img(), { x: 0, y: 0, w: 5, h: 4 })).toBe(1.25); // preview + form agree on 1.25
  });
  it("falls back to 1 only when there is neither a measured aspect nor a box", () => {
    expect(imageAspectRatio(img(), undefined)).toBe(1);
  });
});

describe("案B: dragImageRect (preview drag/resize math)", () => {
  const base = { x: 2, y: 2, w: 4, h: 2 }; // ar 2
  it("move translates the box", () => {
    expect(dragImageRect("move", base, 1, -1, 2, 13.33, 7.5)).toEqual({ x: 3, y: 1, w: 4, h: 2 });
  });
  it("move clamps the box onto the slide", () => {
    expect(dragImageRect("move", { x: 0, y: 0, w: 4, h: 2 }, -5, -5, 2, 13.33, 7.5)).toMatchObject({ x: 0, y: 0 });
  });
  it("SE handle resizes from the top-left anchor, keeping aspect (width-driven)", () => {
    const r = dragImageRect("se", base, 2, 99, 2, 13.33, 7.5);
    expect(r).toMatchObject({ x: 2, y: 2, w: 6 });
    expect(r.h).toBeCloseTo(3, 5); // 6 / ar(2)
  });
  it("NW handle resizes from the bottom-right anchor (drag out = grow)", () => {
    const r = dragImageRect("nw", { x: 5, y: 4, w: 4, h: 2 }, -1, 0, 2, 13.33, 7.5);
    // anchor = (9,6); w = 4-(-1)=5, h=2.5, x=9-5=4, y=6-2.5=3.5
    expect(r).toMatchObject({ x: 4, y: 3.5, w: 5 });
    expect(r.h).toBeCloseTo(2.5, 5);
  });
  it("never shrinks below the min size", () => {
    expect(dragImageRect("se", base, -100, 0, 2, 13.33, 7.5).w).toBeGreaterThanOrEqual(0.4);
  });
});

describe("案B: PPTX honors the rect + crops for cover", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(REPORT)); });

  const exportSlide = async (attr: string) => {
    const deck = parseMd(`# 画像\n\n![a](${IMG})${attr}`);
    deck.template = undefined;
    const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
    return zip.file("ppt/slides/slide1.xml")!.async("string");
  };

  it("places <p:pic> at the manual rect (EMU)", async () => {
    const s1 = await exportSlide(`{x=2,y=1.5,w=4,h=3,ar=1.3333}`);
    const m = s1.match(/name="Image"[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/)!;
    // ar (1.333) == box ar (4/3) → contain fits exactly → pic == the rect, no letterbox shrink.
    expect(Number(m[1])).toBe(EMU(2));
    expect(Number(m[2])).toBe(EMU(1.5));
    expect(Number(m[3])).toBe(EMU(4));
    expect(Number(m[4])).toBe(EMU(3));
  });

  it("cover with a non-matching aspect emits <a:srcRect> (crop) and fills the box", async () => {
    // box ar = 4/2 = 2.0, image ar = 1.0 (square) → image relatively taller → crop top+bottom.
    const s1 = await exportSlide(`{x=1,y=1,w=4,h=2,fit=cover,ar=1}`);
    expect(s1).toContain("name=\"Image\"");
    expect(s1).toMatch(/<a:srcRect [tb]="\d+"/); // cropped vertically to fill the wide box
    const m = s1.match(/name="Image"[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/)!;
    expect(Number(m[1])).toBe(EMU(4)); // cover fills the full box
    expect(Number(m[2])).toBe(EMU(2));
  });

  it("contain with a non-matching aspect letterboxes (pic shrinks, centered, no srcRect)", async () => {
    // box ar = 4/2 = 2.0, image ar = 1.0 → contain fits by width→ h = w/ar? no: fit inside box.
    // scale = min(4/1,2/1)=2 (bounded by height) → fitted = ar*h_box? compute: image taller-ratio=1 < box 2
    // → width-bound: w_fit = h_box*ar = 2*1 = 2, centered x = 1 + (4-2)/2 = 2.
    const s1 = await exportSlide(`{x=1,y=1,w=4,h=2,fit=contain,ar=1}`);
    expect(s1).not.toContain("<a:srcRect"); // contain never crops
    const m = s1.match(/name="Image"[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/)!;
    expect(Number(m[3])).toBe(EMU(2)); // letterboxed width
    expect(Number(m[4])).toBe(EMU(2)); // full height
    expect(Number(m[1])).toBe(EMU(2)); // centered horizontally
    expect(Number(m[2])).toBe(EMU(1));
  });
});
