/**
 * diagram-node-shrink.test.ts — #473: the layout engine shrinks a node-edge figure to fit its slide
 * (or its placeholder region) and never says so. A WBS-sized orgchart (3 levels / 20 nodes) ends up
 * at 0.68×0.24in per node — its labels are below the legible floor — yet diagnoseDeck stayed silent,
 * while 9 nodes keep near-default boxes. This locks a never-silent warn `diagram-node-shrink` that is
 * DERIVED from the same computeLayout result (NodePosition w/h/scale) + the same region fit
 * (fitTransform) + the same label-font scaling (scaledFontSize) export paints with (R8: no second
 * shrink computation). Placement and output are untouched — diagnostics only.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseMd } from "../src/engine/md-parser";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";
import { DiagramSpecSchema } from "../src/engine/schema";
import { computeLayout } from "../src/engine/layout-engine";
import { fitTransform, scaledFontSize } from "../src/engine/draw-target";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { bodyPlaceholders, nthBody } from "../src/engine/visual-placement";
import { diagramNodeShrink, LEGIBLE_LABEL_PT } from "../src/engine/diagram-node-shrink";
import { loadYaml } from "../src/engine/yaml-io";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

/** A WBS-shaped orgchart: root → one mid node per entry → that many leaves under it. */
function orgchartYaml(leavesPerMid: number[], direction: "TB" | "LR" = "TB"): string {
  const lines = [`type: orgchart`, `direction: ${direction}`, `nodes:`, `  - id: root`, `    label: プロジェクト`];
  const edges: string[] = [];
  leavesPerMid.forEach((k, i) => {
    lines.push(`  - id: m${i}`, `    label: "${i + 1} 要件定義"`);
    edges.push(`  - from: root`, `    to: m${i}`);
    for (let j = 0; j < k; j++) {
      lines.push(`  - id: m${i}l${j}`, `    label: "${i + 1}.${j + 1} 業務要件"`);
      edges.push(`  - from: m${i}`, `    to: m${i}l${j}`);
    }
  });
  return [...lines, `edges:`, ...edges].join("\n");
}

// The issue's repro: 3 levels, 20 nodes (root + 5 mids + 14 leaves) vs a 9-node chart (root + 2 + 6).
const WBS_20 = orgchartYaml([3, 3, 3, 3, 2]);
const WBS_9 = orgchartYaml([3, 3]);
const fence = (yaml: string) => "```diagram\n" + yaml + "\n```";
const shrinkIssues = (md: string, catalog?: LayoutCatalog, layouts?: TemplateData["layouts"]) =>
  diagnoseDeck(parseMd(md), catalog, layouts).filter((i) => i.id === "diagram-node-shrink");

describe("diagnoseDeck — diagram-node-shrink (#473)", () => {
  it("is a registered warn rule (single registry, R8)", () => {
    expect(REVIEW_RULES.find((r) => r.id === "diagram-node-shrink")?.level).toBe("warn");
  });

  it("20-node orgchart (solo figure) → exactly 1 warn naming node count, direction and the levers", () => {
    const issues = shrinkIssues(`# WBS\n\n${fence(WBS_20)}`);
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(0);
    expect(issues[0].title).toBe("WBS");
    expect(issues[0].level).toBe("warn");
    expect(issues[0].levers).toEqual(["split"]);
    expect(issues[0].message).toContain("20");
    expect(issues[0].message).toContain("TB");
    for (const hint of ["分割", "LR", "mindmap", "表"]) expect(issues[0].message).toContain(hint);
  });

  it("9-node orgchart → no diagnostic (below-threshold decks gain nothing)", () => {
    expect(shrinkIssues(`# 組織\n\n${fence(WBS_9)}`)).toHaveLength(0);
    expect(diagnoseDeck(parseMd(`# 組織\n\n${fence(WBS_9)}`))).toHaveLength(0);
  });

  it("LR variant reports its own direction", () => {
    const issues = shrinkIssues(`# WBS\n\n${fence(orgchartYaml([3, 3, 3, 3, 2], "LR"))}`);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("LR");
  });

  it("the reported node size is READ OFF computeLayout, not recomputed (agreement, R8)", () => {
    const spec = DiagramSpecSchema.parse(loadYaml(WBS_20));
    const pos = computeLayout(spec); // export paints a titled slide's figure with the painter's default contentTop
    const minH = Math.min(...pos.map((p) => p.h));
    const minW = Math.min(...pos.map((p) => p.w));
    const s = diagramNodeShrink(spec);
    expect(s).toBeDefined();
    expect(s!.minNodeW).toBeCloseTo(minW, 6);
    expect(s!.minNodeH).toBeCloseTo(minH, 6);
    expect(s!.nodeCount).toBe(20);
    // The threshold is the painter's own label font: default 11pt × layout scale (floor 5pt).
    expect(s!.minLabelPt).toBeCloseTo(scaledFontSize(11, pos[0].scale), 6);
    expect(s!.minLabelPt).toBeLessThan(LEGIBLE_LABEL_PT);
    // The issue's measured figures (main 9344a94): 0.68×0.24in.
    expect(minW).toBeCloseTo(0.68, 2);
    expect(minH).toBeCloseTo(0.24, 2);
    // 9 nodes stay legible → undefined (not a near-miss object).
    const spec9 = DiagramSpecSchema.parse(loadYaml(WBS_9));
    expect(diagramNodeShrink(spec9)).toBeUndefined();
    expect(scaledFontSize(11, computeLayout(spec9)[0].scale)).toBeGreaterThanOrEqual(LEGIBLE_LABEL_PT);
  });

  it("a node's own font_size (classDefs / style) is what gets compared, as the painter resolves it", () => {
    // 9 nodes pass at the default 11pt; a class setting 7pt is below the floor once ANY shrink applies.
    const small = WBS_9.replace("type: orgchart", "type: orgchart\nclassDefs:\n  tiny:\n    font_size: 7").replace(/label: "(\d\.\d)/g, 'class: tiny\n    label: "$1');
    const spec = DiagramSpecSchema.parse(loadYaml(small));
    expect(computeLayout(spec)[0].scale).toBeLessThan(1);
    expect(diagramNodeShrink(spec)?.minLabelPt).toBeCloseTo(scaledFontSize(7, computeLayout(spec)[0].scale), 6);
  });

  it("non node-edge figures (sequence / timeline / kpi …) are out of scope — no computeLayout, no warn", () => {
    const seq = "```mermaid\nsequenceDiagram\n" + Array.from({ length: 12 }, (_, i) => ` A${i}->>B${i}: m${i}`).join("\n") + "\n```";
    expect(shrinkIssues(`# 流れ\n\n${seq}`)).toHaveLength(0);
  });

  describe("region-bound figure (beside body text) — the region fit shrinks it further", () => {
    let tpl: TemplateData;
    let catalog: LayoutCatalog;
    beforeAll(async () => {
      tpl = await loadTemplate(readFileSync(MIDNIGHT));
      catalog = buildCatalog(tpl);
    });
    const BESIDE = `# 体制\n\n- 本文\n\n${fence(WBS_9)}`;

    it("9 nodes beside text → warn (legible solo, illegible in a half-slide region)", () => {
      const deck = parseMd(BESIDE);
      expect(deck.slides[0].diagram?.placeholderIdx).toBe("2");
      const issues = shrinkIssues(BESIDE, catalog, tpl.layouts);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain("9");
    });

    it("the region fit is the export's fitTransform on the resolved placeholder (agreement, R8)", () => {
      const deck = parseMd(BESIDE);
      const layout = tpl.layouts.find((l) => l.name === autoSelectLayout(deck.slides[0], 0, 1, catalog))!;
      const region = nthBody(bodyPlaceholders(layout.placeholders), "2")!.style;
      const spec = DiagramSpecSchema.parse(loadYaml(WBS_9));
      const pos = computeLayout(spec);
      const bbox = {
        minX: Math.min(...pos.map((p) => p.x)), minY: Math.min(...pos.map((p) => p.y)),
        maxX: Math.max(...pos.map((p) => p.x + p.w)), maxY: Math.max(...pos.map((p) => p.y + p.h)),
      };
      const { scale } = fitTransform(bbox, region);
      const s = diagramNodeShrink(spec, region)!;
      expect(s.minNodeH).toBeCloseTo(Math.min(...pos.map((p) => p.h)) * scale, 6);
      expect(s.minLabelPt).toBeCloseTo(scaledFontSize(11, pos[0].scale) * scale, 6);
    });

    it("without a template the region is unknown → silent (export drops/ reports it elsewhere), no 2nd warn with one", () => {
      expect(shrinkIssues(BESIDE)).toHaveLength(0);
      expect(shrinkIssues(BESIDE, catalog)).toHaveLength(0);
      // A solo figure is warned ONCE even when layouts are supplied (per-slide pass only).
      expect(shrinkIssues(`# WBS\n\n${fence(WBS_20)}`, catalog, tpl.layouts)).toHaveLength(1);
    });
  });
});
