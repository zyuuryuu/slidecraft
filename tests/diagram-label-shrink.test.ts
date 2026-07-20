/**
 * diagram-label-shrink.test.ts — #228 (#104 slice A): node-label shrink must be PRE-COMPUTED into
 * the PPTX font size, not delegated to PowerPoint's `fit:"shrink"` autofit. PptxGenJS emits a bare
 * `<a:normAutofit/>` (no fontScale), and PowerPoint only recomputes autofit when the text is next
 * edited (R7) — so a label longer than its node box rendered at FULL size and wrapped/overflowed,
 * while the SVG preview had already shrunk it to fit (svg-writer's estWidth path): a WYSIWYG break.
 * The fix computes ONE shrink scale in a shared helper (draw-target) used by BOTH targets (R8).
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import type { DiagramSpec } from "../src/engine/schema";
import { renderToBuffer } from "../src/engine/pptx-writer";
import { renderDiagramToSvg } from "../src/engine/svg-writer";
import { estTextWidth, shrinkScale } from "../src/engine/draw-target";

// 17 CJK chars × 11pt ≈ wider than the 2.5in node box → must shrink. "OK" fits → must NOT shrink.
const LONG = "申請書類の受付および内容の一次確認";
const SPEC: DiagramSpec = {
  type: "flowchart", direction: "TB", title: "審査", classDefs: {},
  nodes: [
    { id: "a", label: LONG, shape: "rect" },
    { id: "b", label: "OK", shape: "rect" },
  ],
  edges: [{ from: "a", to: "b" }],
  groups: [], lanes: [],
  layout: { node_width: 2.5, node_height: 0.7, h_gap: 0.5, v_gap: 0.8 },
} as unknown as DiagramSpec;

/** The `sz` (pt×100) of the run whose <a:t> is exactly `text`, from slide1.xml. */
function runSize(slideXml: string, text: string): number | undefined {
  for (const m of slideXml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
    if (m[1].includes(`<a:t>${text}</a:t>`)) {
      const sz = m[1].match(/\bsz="(\d+)"/);
      if (sz) return parseInt(sz[1]);
    }
  }
  return undefined;
}

async function slide1(spec: DiagramSpec): Promise<string> {
  const zip = await JSZip.loadAsync(await renderToBuffer(spec));
  return zip.file("ppt/slides/slide1.xml")!.async("string");
}

describe("shared shrink helper (draw-target)", () => {
  it("returns 1 when the widest line fits, the fit ratio when it does not", () => {
    expect(shrinkScale([{ text: "OK", fs: 11 }], 100)).toBe(1);
    const w = estTextWidth(LONG, 11);
    expect(shrinkScale([{ text: LONG, fs: 11 }], w / 2)).toBeCloseTo(0.5, 5);
  });

  it("estimates CJK at 1em and Latin at 0.55em", () => {
    expect(estTextWidth("あ", 10)).toBeCloseTo(10, 5);
    expect(estTextWidth("a", 10)).toBeCloseTo(5.5, 5);
  });
});

describe("PPTX label shrink is pre-computed (#228)", () => {
  it("an overflowing node label gets an explicitly smaller sz; a fitting one stays at base size", async () => {
    const xml = await slide1(SPEC);
    const longSz = runSize(xml, LONG);
    const okSz = runSize(xml, "OK");
    expect(okSz).toBe(1100); // base node-label size, untouched → non-overflow decks stay byte-identical
    expect(longSz).toBeDefined();
    expect(longSz!).toBeLessThan(1100); // pre-shrunk so PowerPoint renders it fitting on first open
    expect(longSz!).toBeGreaterThanOrEqual(500); // scaledFontSize floor (5pt) is never crossed
  });

  it("agreement (R8): the PPTX pre-shrunk size equals the SVG preview's shrunk size", async () => {
    const xml = await slide1(SPEC);
    const svg = renderDiagramToSvg(SPEC);
    const longSz = runSize(xml, LONG)! / 100; // pt
    const m = svg.match(new RegExp(`font-size="([\\d.]+)px"[^>]*>${LONG}`));
    expect(m).toBeTruthy();
    const svgPt = parseFloat(m![1]) / (96 / 72); // px → pt
    expect(Math.abs(longSz - svgPt)).toBeLessThan(0.1);
  });
});
