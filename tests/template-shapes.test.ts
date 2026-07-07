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

const DIR = resolve(__dirname, "../public/templates/slide");
const REPORT = resolve(DIR, "報告書テンプレート_全レイアウト見本.pptx"); // tracked fixture: has ellipse + rightArrow
const CX = resolve(DIR, "CX_sample_MSGothic.pptx"); // gitignored local fixture: has custGeom brand shapes

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
