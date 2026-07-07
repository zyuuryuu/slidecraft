/**
 * ooxml-geom.test.ts — the pure geometry for the last two preview-drawing gaps: <p:grpSp> group
 * child→slide coordinate transforms and custGeom <a:arcTo> → SVG arc. Tested without a full .pptx.
 */
import { describe, it, expect } from "vitest";
import { parseGroupXf, composeXf, transformRect, topLevelBlocks, arcToSvg, IDENTITY_XF } from "../src/engine/ooxml-geom";

const EMU = 914400; // 1 inch

describe("group transform (parseGroupXf / transformRect)", () => {
  // A group at slide (1in,0) sized 2in×2in whose child space is 0..2in (chExt = ext) → scale 1,
  // translate +1in in x. A child at child-space (0,0) 1in×1in lands at slide (1in,0), 1in×1in.
  const grpSpPr = `<p:grpSpPr><a:xfrm>` +
    `<a:off x="${EMU}" y="0"/><a:ext cx="${2 * EMU}" cy="${2 * EMU}"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="${2 * EMU}" cy="${2 * EMU}"/>` +
    `</a:xfrm></p:grpSpPr>`;

  it("derives the child→parent affine transform from off/ext + chOff/chExt", () => {
    const xf = parseGroupXf(grpSpPr)!;
    expect(xf.sx).toBeCloseTo(1); expect(xf.sy).toBeCloseTo(1);
    expect(xf.tx).toBeCloseTo(EMU); expect(xf.ty).toBeCloseTo(0);
    const r = transformRect(xf, 0, 0, EMU, EMU);
    expect(r).toEqual({ x: 1, y: 0, w: 1, h: 1 }); // child (0,0,1in,1in) → slide (1in,0,1in,1in)
  });

  it("scales child coordinates when chExt ≠ ext (a shrunk group)", () => {
    // group 4in wide but child space 8in wide → scale 0.5; a child at child-x 4in lands at +2in.
    const g = `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${4 * EMU}" cy="${4 * EMU}"/>` +
      `<a:chOff x="0" y="0"/><a:chExt cx="${8 * EMU}" cy="${8 * EMU}"/></a:xfrm></p:grpSpPr>`;
    const xf = parseGroupXf(g)!;
    expect(xf.sx).toBeCloseTo(0.5);
    expect(transformRect(xf, 4 * EMU, 0, 2 * EMU, 2 * EMU)).toEqual({ x: 2, y: 0, w: 1, h: 1 });
  });

  it("composes a nested transform so a group-in-a-group maps straight to slide space", () => {
    const outer = parseGroupXf(grpSpPr)!; // +1in, scale 1
    const inner = { sx: 1, sy: 1, tx: EMU, ty: 0 }; // another +1in
    const composed = composeXf(outer, inner);
    expect(transformRect(composed, 0, 0, EMU, EMU)).toEqual({ x: 2, y: 0, w: 1, h: 1 }); // +1 +1 = 2in
  });

  it("identity transform is a pure EMU→inch conversion", () => {
    expect(transformRect(IDENTITY_XF, 2 * EMU, EMU, EMU, EMU)).toEqual({ x: 2, y: 1, w: 1, h: 1 });
  });

  it("returns undefined when the xfrm lacks a child coordinate system", () => {
    expect(parseGroupXf(`<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm></p:grpSpPr>`)).toBeUndefined();
  });
});

describe("topLevelBlocks — depth-balanced group extraction", () => {
  it("captures a nested group as ONE outer block (not mis-split at the inner close)", () => {
    const xml = `<p:grpSp><p:sp>A</p:sp><p:grpSp><p:sp>B</p:sp></p:grpSp></p:grpSp>`;
    const blocks = topLevelBlocks(xml, "p:grpSp");
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toBe(xml); // the whole outer group, inner group included
  });
  it("captures sibling groups separately", () => {
    const xml = `<p:grpSp><p:sp>A</p:sp></p:grpSp><p:sp>mid</p:sp><p:grpSp><p:sp>B</p:sp></p:grpSp>`;
    expect(topLevelBlocks(xml, "p:grpSp").length).toBe(2);
  });
  it("matches an open tag that carries attributes", () => {
    const xml = `<p:grpSp id="3"><p:sp>A</p:sp></p:grpSp>`;
    expect(topLevelBlocks(xml, "p:grpSp")).toEqual([xml]);
  });
});

describe("arcToSvg — custGeom elliptical arc → SVG A segment", () => {
  it("emits an SVG arc to the swept end point (90° from the +x point of a circle)", () => {
    // pen at (100,0) on a circle radius 100 (angle 0); sweep +90° (5400000) → end at (0,100).
    const { seg, end } = arcToSvg({ x: 100, y: 0 }, 100, 100, 0, 5400000);
    expect(seg).toBe("A100 100 0 0 1 0 100 "); // rx ry rot large(0) sweep(1) endX endY
    expect(end).toEqual({ x: 0, y: 100 });
  });
  it("sets the large-arc + sweep flags from |swAng| and the sign of swAng", () => {
    expect(arcToSvg({ x: 100, y: 0 }, 100, 100, 0, 16200000).seg).toMatch(/^A100 100 0 1 1 /); // 270° → large
    expect(arcToSvg({ x: 100, y: 0 }, 100, 100, 0, -5400000).seg).toMatch(/^A100 100 0 0 0 /); // negative → sweep 0
  });
});
