/**
 * ooxml-fill.test.ts — the pure OOXML fill helpers the preview extractor gained: picture fills
 * (primary blip + non-web→svgBlip fallback) and gradient fills (<a:gradFill> → CSS). These are the
 * risky parts of the preview-rendering polish (A1/A2/A3), tested without a full .pptx.
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  gradFillCss, backgroundGradientCss, blipEmbedIds, resolveEmbedDataUri, resolveBlipFillSrc,
  backgroundImageSrc, buildRelMap,
} from "../src/engine/ooxml-fill";

const THEME = { accent1: "2E5C8A", bg1: "FFFFFF", tx1: "111111" };
// 1×1 transparent PNG / a tiny SVG — enough to prove data-URI resolution + MIME selection.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'><rect width='2' height='2'/></svg>";

describe("gradFillCss (A3 shape / A1 bg gradient)", () => {
  it("converts a 2-stop linear gradFill to CSS + the first stop color", () => {
    const xml = `<a:gradFill><a:gsLst>` +
      `<a:gs pos="0"><a:srgbClr val="112233"/></a:gs>` +
      `<a:gs pos="100000"><a:srgbClr val="445566"/></a:gs>` +
      `</a:gsLst><a:lin ang="0"/></a:gradFill>`;
    const g = gradFillCss(xml, THEME)!;
    expect(g.first).toBe("112233");
    // ang=0 (east/→) maps to CSS 90deg; stops keep their %.
    expect(g.css).toBe("linear-gradient(90deg, #112233 0%, #445566 100%)");
  });

  it("maps the OOXML angle (60000ths, from east) to the CSS angle (from north)", () => {
    const mk = (ang: string) => `<a:gradFill><a:gs pos="0"><a:srgbClr val="000000"/></a:gs>` +
      `<a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs><a:lin ang="${ang}"/></a:gradFill>`;
    expect(gradFillCss(mk("5400000"), THEME)!.css).toMatch(/^linear-gradient\(180deg,/); // 90°→south→to bottom
    expect(gradFillCss(mk("16200000"), THEME)!.css).toMatch(/^linear-gradient\(0deg,/);  // 270°→north→to top
  });

  it("resolves theme scheme-color stops through the theme map", () => {
    const xml = `<a:gradFill><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs>` +
      `<a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs><a:lin ang="0"/></a:gradFill>`;
    expect(gradFillCss(xml, THEME)!.css).toContain("#2E5C8A 0%");
  });

  it("returns undefined for a solid fill or a single-stop gradient (not a usable gradient)", () => {
    expect(gradFillCss(`<a:solidFill><a:srgbClr val="112233"/></a:solidFill>`, THEME)).toBeUndefined();
    expect(gradFillCss(`<a:gradFill><a:gs pos="0"><a:srgbClr val="112233"/></a:gs></a:gradFill>`, THEME)).toBeUndefined();
  });

  it("backgroundGradientCss unwraps a <p:bg> gradient", () => {
    const bg = `<p:bg><p:bgPr><a:gradFill><a:gs pos="0"><a:srgbClr val="0A0A0A"/></a:gs>` +
      `<a:gs pos="100000"><a:srgbClr val="1A1A1A"/></a:gs><a:lin ang="0"/></a:gradFill></p:bgPr></p:bg>`;
    expect(backgroundGradientCss(bg, THEME)).toBe("linear-gradient(90deg, #0A0A0A 0%, #1A1A1A 100%)");
  });
});

describe("blipEmbedIds (A2 primary vs svgBlip)", () => {
  it("captures the primary blip and the svgBlip alternative separately", () => {
    const pic = `<p:pic><p:blipFill><a:blip r:embed="rId2"><a:extLst><a:ext>` +
      `<asvg:svgBlip xmlns:asvg="…" r:embed="rId3"/></a:ext></a:extLst></a:blip></p:blipFill></p:pic>`;
    expect(blipEmbedIds(pic)).toEqual({ primary: "rId2", svg: "rId3" });
  });
  it("handles an svgBlip-only pic (no primary embed)", () => {
    const pic = `<p:pic><p:blipFill><a:blip><a:extLst><a:ext>` +
      `<asvg:svgBlip r:embed="rId9"/></a:ext></a:extLst></a:blip></p:blipFill></p:pic>`;
    expect(blipEmbedIds(pic)).toEqual({ primary: undefined, svg: "rId9" });
  });
});

describe("resolveEmbedDataUri / resolveBlipFillSrc (A2 non-web fallback)", () => {
  const zip = new JSZip();
  zip.file("ppt/media/logo.png", PNG_B64, { base64: true });
  zip.file("ppt/media/logo.svg", SVG);
  const relMap = buildRelMap(
    `<Relationships>` +
    `<Relationship Id="rPng" Type="…/image" Target="../media/logo.png"/>` +
    `<Relationship Id="rSvg" Type="…/image" Target="../media/logo.svg"/>` +
    `<Relationship Id="rWdp" Type="…/image" Target="../media/logo.wdp"/>` +
    `</Relationships>`,
  );
  const DIR = "ppt/slideLayouts";

  it("resolves a web format to a data: URI with the right MIME", async () => {
    expect(await resolveEmbedDataUri("rPng", relMap, DIR, zip)).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(await resolveEmbedDataUri("rSvg", relMap, DIR, zip)).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("returns undefined for a non-web format (wdp) — a browser <img> can't paint it", async () => {
    expect(await resolveEmbedDataUri("rWdp", relMap, DIR, zip)).toBeUndefined();
  });

  it("falls back to the svgBlip when the PRIMARY blip is a non-web format", async () => {
    const pic = `<p:pic><p:blipFill><a:blip r:embed="rWdp"><a:extLst><a:ext>` +
      `<asvg:svgBlip r:embed="rSvg"/></a:ext></a:extLst></a:blip></p:blipFill></p:pic>`;
    // primary (wdp) is unrenderable → the SVG alternative wins, so the logo still shows.
    expect(await resolveBlipFillSrc(pic, relMap, DIR, zip)).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("uses the primary blip when it IS a web format (a normal SVG pic renders via its PNG primary)", async () => {
    const pic = `<p:pic><p:blipFill><a:blip r:embed="rPng"><a:extLst><a:ext>` +
      `<asvg:svgBlip r:embed="rSvg"/></a:ext></a:extLst></a:blip></p:blipFill></p:pic>`;
    expect(await resolveBlipFillSrc(pic, relMap, DIR, zip)).toBe(`data:image/png;base64,${PNG_B64}`);
  });

  it("backgroundImageSrc resolves a <p:bg> picture fill", async () => {
    const bg = `<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rPng"/></a:blipFill></p:bgPr></p:bg>`;
    expect(await backgroundImageSrc(bg, relMap, DIR, zip)).toBe(`data:image/png;base64,${PNG_B64}`);
  });
  it("backgroundImageSrc returns undefined for a solid-color <p:bg>", async () => {
    const bg = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:bgPr></p:bg>`;
    expect(await backgroundImageSrc(bg, relMap, DIR, zip)).toBeUndefined();
  });
});
