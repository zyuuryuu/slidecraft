/**
 * image-placeholder.test.ts — B: an embedded image prefers a PICTURE-type placeholder when the
 * layout has one (imagePlaceholder), and falls back to the Nth BODY exactly as before when it
 * doesn't. Bundled canonical/report templates carry NO type="pic", so this is a no-op there and is
 * exercised on an IMPORTED master that does (velis: Two Columns, Picture Right … type="pic").
 *
 * The resolver is shared by preview / form / PPTX, so binding can't diverge — the PPTX case below
 * proves the exported <p:pic> lands in the picture frame's geometry, not the body region's.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, autoSelectLayout, type TemplateData, type LayoutInfo } from "../src/engine/template-loader";
import { placeholderRole, buildCatalog } from "../src/engine/template-catalog";
import { imagePlaceholder, bodyPlaceholders, nthBody } from "../src/engine/visual-placement";
import { parseMd } from "../src/engine/md-parser";
import { generatePptx } from "../src/engine/placeholder-filler";

const VELIS = resolve(__dirname, "fixtures/templates/lrk-slides-velis_CC0.pptx"); // has type="pic"
const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx"); // body-only
const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const EMU = (inches: number) => Math.round(inches * 914400);
const pics = (l: LayoutInfo) => l.placeholders.filter((p) => placeholderRole(p) === "picture");

describe("B: image binds to a picture placeholder when present", () => {
  let velis: TemplateData;
  let report: TemplateData;
  beforeAll(async () => {
    velis = await loadTemplate(readFileSync(VELIS));
    report = await loadTemplate(readFileSync(REPORT));
  });

  it("PREFERS a picture-type placeholder over the body region", () => {
    const layout = velis.layouts.find((l) => pics(l).length >= 1);
    expect(layout, "velis must expose a layout with a type=pic placeholder").toBeTruthy();
    const ph = imagePlaceholder(layout!.placeholders, "1");
    expect(ph).toBeTruthy();
    expect(placeholderRole(ph!)).toBe("picture"); // NOT a body — the picture frame wins
  });

  it("FALLS BACK to the Nth body placeholder — IDENTICAL to today — when no picture frame exists", () => {
    const layout = report.layouts.find((l) => bodyPlaceholders(l.placeholders).length >= 1 && pics(l).length === 0);
    expect(layout, "report must expose a body-only layout").toBeTruthy();
    const got = imagePlaceholder(layout!.placeholders, "1");
    const legacy = nthBody(bodyPlaceholders(layout!.placeholders), "1");
    expect(got).toBeDefined();
    expect(got!.idx).toBe(legacy!.idx); // exact same binding as before B (no regression)
  });

  it("rides the Nth picture frame by ordinal, and clamps a too-large ordinal to a picture (not body)", () => {
    const layout = velis.layouts.find((l) => pics(l).length >= 2);
    expect(layout, "velis must expose a layout with ≥2 pic placeholders").toBeTruthy();
    const ordered = [...pics(layout!)].sort((a, b) => a.idx.length - b.idx.length || a.idx.localeCompare(b.idx));
    expect(imagePlaceholder(layout!.placeholders, "1")!.idx).toBe(ordered[0].idx);
    expect(imagePlaceholder(layout!.placeholders, "2")!.idx).toBe(ordered[1].idx);
    const clamped = imagePlaceholder(layout!.placeholders, "99")!; // past the count → stays on a picture
    expect(placeholderRole(clamped)).toBe("picture");
  });

  it("returns undefined when there is no placeholderIdx (parity with nthBody)", () => {
    const layout = velis.layouts.find((l) => pics(l).length >= 1)!;
    expect(imagePlaceholder(layout.placeholders, undefined)).toBeUndefined();
  });

  it("EXPORT: the <p:pic> lands in the picture frame's geometry (not a body/degenerate 0×0 box)", async () => {
    const layout = velis.layouts.find((l) => pics(l).length >= 1)!;
    const expected = imagePlaceholder(layout.placeholders, "1")!; // the picture frame
    const deck = parseMd(`# 画像\n\n![pic](${IMG})`);
    deck.template = undefined;
    deck.slides[0].layout = layout.name; // pin to the picture-bearing layout (honored by autoSelectLayout)

    const zip = await JSZip.loadAsync(await generatePptx(deck, velis));
    const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const m = s1.match(/name="Image"[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/);
    expect(m, "an Image <p:pic> with explicit xfrm must be present").toBeTruthy();
    const [, x, y, cx, cy] = m!;
    expect(Number(x)).toBe(EMU(expected.style.x));
    expect(Number(y)).toBe(EMU(expected.style.y));
    expect(Number(cx)).toBe(EMU(expected.style.w));
    expect(Number(cy)).toBe(EMU(expected.style.h));
    expect(Number(cx)).toBeGreaterThan(0); // guards the inherited-xfrm collapse-to-0×0 risk
    expect(Number(cy)).toBeGreaterThan(0);
  });
});

describe("案B: image slides prefer a picture-frame layout (autoSelectLayout)", () => {
  let velis: TemplateData;
  beforeAll(async () => { velis = await loadTemplate(readFileSync(VELIS)); });
  const titlePh = { idx: "15", paragraphs: [{ segments: [{ text: "見出し" }] }] };

  it("auto-selects a layout that HAS a picture frame for an image slide", () => {
    const catalog = buildCatalog(velis);
    const slide = { layout: "auto", placeholders: [titlePh], image: { src: IMG, alt: "", placeholderIdx: "1" } } as never;
    const entry = catalog.find((e) => e.name === autoSelectLayout(slide, 1, 3, catalog))!;
    expect(entry.placeholders.some((p) => p.role === "picture")).toBe(true);
  });

  it("does NOT push a text slide to a picture layout — it keeps a real text body (regression)", () => {
    const catalog = buildCatalog(velis);
    const slide = { layout: "auto", placeholders: [titlePh, { idx: "1", paragraphs: [{ segments: [{ text: "本文テキスト" }] }] }] } as never;
    const entry = catalog.find((e) => e.name === autoSelectLayout(slide, 1, 3, catalog))!;
    expect(entry.placeholders.some((p) => p.role === "body" && p.charsPerLine > 0 && p.maxLines > 0)).toBe(true);
  });
});
