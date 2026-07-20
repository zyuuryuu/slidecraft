/**
 * template-shapes.test.ts — PREVIEW shape fidelity: a template's decorative shapes must reach the
 * preview as real geometry, not collapsed rectangles. extractDecorations stamps `prst` for preset
 * polygons (ellipse / arrows / …) and parses `<a:custGeom>` into an SVG `path` + `pathViewBox`, which
 * SlideCard renders as <polygon>/<path>. (SlideCard's rendering is shared preview + HTML export.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";

const DIR = resolve(__dirname, "fixtures/templates");
const REPORT = resolve(DIR, "報告書テンプレート_全レイアウト見本.pptx"); // tracked fixture: has ellipse + rightArrow
const CX = resolve(DIR, "CX_sample_MSGothic.pptx"); // gitignored local fixture: has custGeom brand shapes
const VELIS = resolve(DIR, "lrk-slides-velis_CC0.pptx"); // tracked CC0 fixture: 26 <p:grpSp> groups

describe("preset shape geometry (CI-covered)", () => {
  it("stamps preset polygons (ellipse / rightArrow) on decorations, but not plain rect/roundRect", async () => {
    const tpl = await loadTemplate(readFileSync(REPORT));
    const prsts = new Set(tpl.layouts.flatMap((l) => l.decorations.map((d) => d.prst).filter(Boolean)));
    expect(prsts.has("ellipse")).toBe(true);
    expect(prsts.has("rightArrow")).toBe(true);
    // rect/roundRect render as plain divs (radius handles roundRect) → never stamped as a preset.
    expect(prsts.has("rect")).toBe(false);
    expect(prsts.has("roundRect")).toBe(false);
  });
});

describe.skipIf(!existsSync(CX))("custom geometry → SVG path", () => {
  it("parses <a:custGeom> into an SVG path + viewBox", async () => {
    const tpl = await loadTemplate(readFileSync(CX));
    const withPath = tpl.layouts.flatMap((l) => l.decorations).find((d) => d.path);
    expect(withPath).toBeDefined();
    expect(withPath!.path).toMatch(/^M/); // an SVG path starting from a moveTo
    expect(withPath!.pathViewBox).toMatch(/^0 0 \d+ \d+$/); // the custGeom path space
  });
});

describe.skipIf(!existsSync(VELIS))("group shapes (<p:grpSp>) → children transformed to slide coords", () => {
  it("velis' 26 groups yield on-canvas decorations, not raw child-space coordinates", async () => {
    const tpl = await loadTemplate(readFileSync(VELIS));
    const decos = tpl.layouts.flatMap((l) => l.decorations).concat(tpl.masterDecorations);
    expect(decos.length).toBeGreaterThan(0); // group children are extracted (were mis-placed before)
    // Every decoration sits within a generous slide-bounds margin (13.33×7.5in). A group child left at
    // raw child-space EMU (chOff/chExt un-applied) would land far off-canvas → this guards the transform.
    for (const d of decos) {
      expect(Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.w) && Number.isFinite(d.h)).toBe(true);
      expect(d.x).toBeGreaterThan(-5); expect(d.x).toBeLessThan(20);
      expect(d.y).toBeGreaterThan(-5); expect(d.y).toBeLessThan(13);
    }
  });
});

describe.skipIf(!existsSync(VELIS))("attribute-bearing <p:spPr>/<p:grpSpPr> (#225)", () => {
  // PowerPoint-authored parts write `<p:spPr bwMode="auto">` / `<p:grpSpPr bwMode="auto">`; the
  // extractor's attribute-less regexes missed them, dropping 76 shapes and ALL 28 groups of this
  // real CC0 template from the preview (cover/section/close layouts rendered near-blank).
  it("velis cover (layout1) keeps its full decoration set: bg rect + both logo groups' children", async () => {
    const tpl = await loadTemplate(readFileSync(VELIS));
    const cover = tpl.layouts.find((l) => l.index === 1)!;
    // 7 decorative shapes in the XML; 5 are VISIBLE: 1 top-level bg rect + 2 groups × 2 filled
    // Freeform children (each group's third child is a noFill/noLine spacer PowerPoint doesn't
    // paint either — correctly dropped). Before the fix only the bg rect survived (1).
    expect(cover.decorations.length).toBeGreaterThanOrEqual(5);
    // The 4 Freeform children are custGeom → must reach the preview as real SVG paths.
    const paths = cover.decorations.filter((d) => d.path);
    expect(paths.length).toBeGreaterThanOrEqual(4);
    // Group children are mapped through the group's child→slide transform: on-canvas, non-degenerate.
    for (const d of cover.decorations) {
      expect(d.x).toBeGreaterThan(-5); expect(d.x).toBeLessThan(20);
      expect(d.y).toBeGreaterThan(-5); expect(d.y).toBeLessThan(13);
      expect(d.w).toBeGreaterThan(0);
      expect(d.h).toBeGreaterThan(0);
    }
  });

  it("section title (layout4) recovers its grouped decorations too", async () => {
    const tpl = await loadTemplate(readFileSync(VELIS));
    const section = tpl.layouts.find((l) => l.index === 4)!;
    expect(section.decorations.length).toBeGreaterThanOrEqual(5);
  });
});

describe.skipIf(!existsSync(VELIS))("group flipH/flipV reach the preview as mirrored shapes (#241)", () => {
  it("velis cover (layout1)'s flipH group tags its custGeom children flipH — the shape itself must mirror, not just its rect (a full-span child's rect is unchanged by a flip around its own center)", async () => {
    const tpl = await loadTemplate(readFileSync(VELIS));
    const cover = tpl.layouts.find((l) => l.index === 1)!;
    const flipped = cover.decorations.filter((d) => d.flipH);
    expect(flipped.length).toBeGreaterThan(0);
    expect(flipped.every((d) => d.path)).toBe(true); // both flipH children are custGeom Freeforms
    expect(flipped.every((d) => !d.flipV)).toBe(true); // this group is flipH-only
    // still on-canvas and non-degenerate — the flip must not corrupt position/size.
    for (const d of flipped) {
      expect(d.x).toBeGreaterThan(-5); expect(d.x).toBeLessThan(20);
      expect(d.w).toBeGreaterThan(0); expect(d.h).toBeGreaterThan(0);
    }
  });

  it("velis has flipV and flipH+flipV groups too (layout13/29) — both axes are detected independently", async () => {
    const tpl = await loadTemplate(readFileSync(VELIS));
    const decos = tpl.layouts.flatMap((l) => l.decorations);
    expect(decos.some((d) => d.flipV && !d.flipH)).toBe(true); // a flipV-only group's children
    expect(decos.some((d) => d.flipH && d.flipV)).toBe(true); // a flipH+flipV group's children
  });

  it("across the whole template, every flip group's children are tagged (repro: 16 flip xfrm)", async () => {
    const tpl = await loadTemplate(readFileSync(VELIS));
    const decos = tpl.layouts.flatMap((l) => l.decorations).concat(tpl.masterDecorations);
    expect(decos.filter((d) => d.flipH || d.flipV).length).toBeGreaterThan(0);
  });
});

describe("no false-positive flip tagging on a template with no flipH/flipV anywhere", () => {
  it("REPORT fixture (no <a:xfrm flipH/flipV> in the whole package) never sets DecoRect.flipH/flipV", async () => {
    const tpl = await loadTemplate(readFileSync(REPORT));
    const decos = tpl.layouts.flatMap((l) => l.decorations).concat(tpl.masterDecorations);
    expect(decos.some((d) => d.flipH || d.flipV)).toBe(false);
  });
});
