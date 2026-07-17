/**
 * image-behind.test.ts — 最背面レイヤー: an image can be inserted BEHIND a slide's existing content
 * (image.behind) instead of replacing a placeholder. It renders/exports at the BACKMOST z-order (a
 * <p:pic> before the placeholder shapes — NOT the slide <p:bg>), defaults to the full slide, and the
 * existing title/body text is preserved (round-trip + export).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { imageRect } from "../src/engine/visual-placement";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";

const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");
const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const EMU = (n: number) => Math.round(n * 914400);

describe("最背面: behind flag Markdown round-trip", () => {
  it("parses behind=1 and does NOT replace the body text", () => {
    const md = `# タイトル\n\n- 箇条書き1\n- 箇条書き2\n\n![bg](${IMG}){behind=1,fit=cover}`;
    const slide = parseMd(md).slides[0];
    expect(slide.image?.behind).toBe(true);
    expect(slide.image?.fit).toBe("cover");
    // the bullets survive — the backdrop did not eat the body
    const bodyText = slide.placeholders.map((p) => p.paragraphs.map((par) => par.segments.map((s) => s.text).join("")).join("\n")).join("\n");
    expect(bodyText).toContain("箇条書き1");
    expect(bodyText).toContain("箇条書き2");
  });

  it("survives on a GROUPED (card) slide — not absorbed into a column's body", () => {
    const md = `# カード\n\n<!-- card -->\n### 見出し1\n本文1\n\n<!-- card -->\n### 見出し2\n本文2\n\n![bg](${IMG}){behind=1}`;
    const back = parseMd(serializeMd(parseMd(md))).slides[0];
    expect(back.image?.behind).toBe(true);
    expect(back.groupKind).toBe("card");
    const txt = back.placeholders.map((p) => p.paragraphs.map((par) => par.segments.map((s) => s.text).join("")).join("\n")).join("|");
    expect(txt).not.toContain("![bg]"); // NOT literal text in a column
    expect(txt).toContain("本文2"); // …and both columns intact
  });

  it("coexists with a diagram figure — both survive the round-trip (behind ≠ body figure)", () => {
    const md = `# 図\n\n\`\`\`diagram\nnodes:\n  - id: a\n    label: A\n\`\`\`\n\n![bg](${IMG}){behind=1}`;
    const back = parseMd(serializeMd(parseMd(md))).slides[0];
    expect(back.image?.behind).toBe(true);
    expect(back.diagram?.yaml).toContain("A"); // the diagram is NOT displaced by the backdrop
  });

  it("round-trips (serialize→parse) preserving behind + the body text", () => {
    const md = `# タイトル\n\n- 一つ目\n- 二つ目\n\n![bg](${IMG}){x=0,y=0,w=13.333,h=7.5,behind=1,fit=cover}`;
    const back = parseMd(serializeMd(parseMd(md))).slides[0];
    expect(back.image?.behind).toBe(true);
    const bodyText = back.placeholders.map((p) => p.paragraphs.map((par) => par.segments.map((s) => s.text).join("")).join("")).join("\n");
    expect(bodyText).toContain("一つ目");
    expect(bodyText).toContain("二つ目");
  });
});

describe("最背面: a behind image is a NORMAL-sized figure (NOT full-slide)", () => {
  const ph = { idx: "1", type: "body", name: "Body", shapeXml: "", style: { x: 1, y: 1.5, w: 8, h: 4 } } as never;
  it("uses its placeholder box (same as a body figure) — not the whole slide", () => {
    expect(imageRect({ src: IMG, alt: "", placeholderIdx: "1", behind: true }, ph)).toEqual({ x: 1, y: 1.5, w: 8, h: 4 });
  });
  it("falls back to a centered ~70% box (NOT full-bleed) only when there is no placeholder", () => {
    const r = imageRect({ src: IMG, alt: "", placeholderIdx: "1", behind: true }, undefined)!;
    expect(r.w).toBeLessThan(13.3333); // NOT the full slide width
    expect(r.w).toBeCloseTo(13.3333 * 0.7, 2);
    expect(r.x).toBeGreaterThan(0); // centered, not at the origin
  });
  it("honors an explicit rect on a behind image", () => {
    expect(imageRect({ src: IMG, alt: "", placeholderIdx: "1", behind: true, rect: { x: 1, y: 1, w: 5, h: 4 } }, ph))
      .toEqual({ x: 1, y: 1, w: 5, h: 4 });
  });
});

describe("最背面: PPTX places the behind image at the BACKMOST z-order", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(REPORT)); });

  it("emits the <p:pic> BEFORE the placeholder shapes, and keeps the body text", async () => {
    const deck = parseMd(`# 見出し\n\n- 本文A\n- 本文B\n\n![bg](${IMG}){behind=1,fit=cover}`);
    deck.template = undefined;
    const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
    const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const picIdx = s1.indexOf('name="Image"');
    const firstSp = s1.indexOf("<p:sp>");
    expect(picIdx).toBeGreaterThan(-1);
    expect(firstSp).toBeGreaterThan(-1);
    expect(picIdx).toBeLessThan(firstSp); // the backdrop paints first = behind the text shapes
    expect(s1).toContain("本文A"); // the body text is NOT replaced by the backdrop
    expect(s1).not.toContain("<p:bg>"); // it's a shape, NOT the slide background fill
  });

  it("a behind image is NORMAL-sized, NOT full-bleed (does not blanket the whole slide)", async () => {
    const deck = parseMd(`# 見出し\n\n- 本文A\n\n![bg](${IMG}){behind=1}`);
    deck.template = undefined;
    const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
    const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const m = s1.match(/name="Image"[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/)!;
    expect(Number(m[3])).toBeGreaterThan(0);
    expect(Number(m[3])).toBeLessThan(EMU(13.3333333)); // NOT the full slide width
    expect(Number(m[4])).toBeLessThan(EMU(7.5)); // NOT the full slide height
  });

  it("a NON-behind image stays IN FRONT (after the placeholder shapes) — unchanged", async () => {
    const deck = parseMd(`# T\n\n![fig](${IMG})`);
    deck.template = undefined;
    const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
    const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const picIdx = s1.indexOf('name="Image"');
    const lastSp = s1.lastIndexOf("<p:sp>");
    expect(picIdx).toBeGreaterThan(lastSp); // body figure paints last = in front
  });
});
