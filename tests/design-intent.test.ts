/**
 * design-intent.test.ts — Stage ②: semantic design intent → deterministic geometry.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import yaml from "js-yaml";
import JSZip from "jszip";
import { DesignIntentSchema, applyDesignIntent, parseDesignIntent } from "../src/engine/design-intent";
import { DiagramSpecSchema, type DiagramSpec } from "../src/engine/schema";
import { SLIDE_W } from "../src/engine/layout-engine";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { generatePptx } from "../src/engine/placeholder-filler";
import type { SlideIR } from "../src/engine/slide-schema";

const DIAG = [
  "type: flowchart",
  "direction: TB",
  "nodes:",
  "  - id: A",
  "    label: 入力",
  "  - id: B",
  "    label: DB",
  "edges:",
  "  - from: A",
  "    to: B",
].join("\n");

const slideWithDiagram = (idx = "1"): SlideIR => ({
  layout: "Content.1Body.Single",
  placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "構成" }] }] }],
  diagram: { yaml: DIAG, placeholderIdx: idx },
});
const coexistSlide = (): SlideIR => ({
  layout: "Column.2Body.Equal",
  placeholders: [
    { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
    { idx: "1", paragraphs: [{ segments: [{ text: "要点" }], bullet: true }] },
  ],
  diagram: { yaml: DIAG, placeholderIdx: "2" },
});
const specOf = (s: SlideIR): DiagramSpec => DiagramSpecSchema.parse(yaml.load(s.diagram!.yaml));

describe("DesignIntentSchema", () => {
  it("accepts the intent ops", () => {
    const r = DesignIntentSchema.safeParse([
      { op: "regionSplit", arrangement: "text-left" },
      { op: "emphasize", nodeId: "B" },
      { op: "relayout", direction: "LR" },
    ]);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data[1]).toMatchObject({ op: "emphasize", nodeId: "B", level: "high" });
  });
  it("rejects an unknown op", () => {
    expect(DesignIntentSchema.safeParse([{ op: "wat" }]).success).toBe(false);
  });
});

describe("parseDesignIntent (auto-detect design vs content output)", () => {
  it("detects a DesignIntent JSON array (incl. ```json fence)", () => {
    expect(parseDesignIntent('[{"op":"emphasize","nodeId":"B"}]')).toMatchObject([{ op: "emphasize", nodeId: "B" }]);
    expect(parseDesignIntent('```json\n[{"op":"relayout","direction":"LR"}]\n```')).toMatchObject([{ op: "relayout" }]);
  });
  it("returns null for slide Markdown (content edit)", () => {
    expect(parseDesignIntent("# 見出し\n\n- 要点A\n- 要点B")).toBeNull();
    expect(parseDesignIntent("# T\n\n- リンクは [ここ](http://x) です")).toBeNull(); // a [ in a bullet is not an intent
  });
  it("returns null for a JSON array that isn't valid ops", () => {
    expect(parseDesignIntent('[{"foo":1}]')).toBeNull();
    expect(parseDesignIntent("[]")).toBeNull();
  });
});

describe("emphasize → node override (engine computes + clamps geometry)", () => {
  it("enlarges the target node with a valid, in-bounds override", () => {
    const out = applyDesignIntent(slideWithDiagram(), [{ op: "emphasize", nodeId: "B", level: "high" }]);
    const spec = specOf(out);
    const b = spec.nodes.find((n) => n.id === "B")!;
    const a = spec.nodes.find((n) => n.id === "A")!;
    expect(b.override).toBeDefined();
    expect(b.override!.w!).toBeGreaterThan(2.0); // bigger than the default node width
    expect(b.override!.w!).toBeLessThanOrEqual(SLIDE_W);
    expect(Number.isFinite(b.override!.x!)).toBe(true);
    expect(b.override!.x!).toBeGreaterThanOrEqual(0);
    expect(a.override).toBeUndefined(); // only the named node is touched
  });
  it("is a no-op for an unknown node id", () => {
    const out = applyDesignIntent(slideWithDiagram(), [{ op: "emphasize", nodeId: "ZZZ", level: "high" }]);
    expect(specOf(out).nodes.every((n) => !n.override)).toBe(true);
  });
});

describe("relayout → diagram direction", () => {
  it("sets the direction", () => {
    const out = applyDesignIntent(slideWithDiagram(), [{ op: "relayout", direction: "LR" }]);
    expect(specOf(out).direction).toBe("LR");
  });
});

describe("regionSplit → which column the figure sits in", () => {
  it("text-left puts the figure on the right (col 2), text on the left (col 1)", () => {
    const out = applyDesignIntent(coexistSlide(), [{ op: "regionSplit", arrangement: "text-left" }]);
    expect(out.diagram?.placeholderIdx).toBe("2");
    expect(out.placeholders.find((p) => /^[1-9]$/.test(p.idx))?.idx).toBe("1");
  });
  it("text-right puts the figure on the left (col 1), text on the right (col 2)", () => {
    const out = applyDesignIntent(coexistSlide(), [{ op: "regionSplit", arrangement: "text-right" }]);
    expect(out.diagram?.placeholderIdx).toBe("1");
    expect(out.placeholders.find((p) => /^[1-9]$/.test(p.idx))?.idx).toBe("2");
  });
  it("diagram-only fills the body and drops the bullets", () => {
    const out = applyDesignIntent(coexistSlide(), [{ op: "regionSplit", arrangement: "diagram-only" }]);
    expect(out.diagram?.placeholderIdx).toBe("1");
    expect(out.placeholders.some((p) => /^[1-9]$/.test(p.idx))).toBe(false);
  });
});

describe("Mermaid graduates to the canonical diagram on a design edit", () => {
  it("emphasize on a Mermaid slide converts it to a DiagramSpec", () => {
    const mslide: SlideIR = {
      layout: "Content.1Body.Single",
      placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] }],
      mermaidBlock: { mermaid: "graph TD\n A[入力] --> B[DB]", placeholderIdx: "1" },
    };
    const out = applyDesignIntent(mslide, [{ op: "emphasize", nodeId: "B", level: "high" }]);
    expect(out.mermaidBlock).toBeUndefined(); // graduated
    expect(out.diagram).toBeDefined();
    expect(specOf(out).nodes.find((n) => n.id === "B")?.override).toBeDefined();
  });
});

describe("end-to-end: a design-edited slide still renders on both templates", () => {
  let canonical: TemplateData;
  let alien: TemplateData;
  beforeAll(async () => {
    canonical = await loadTemplate(readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx")));
    alien = await loadTemplate(readFileSync(resolve(__dirname, "../public/templates/slide/lrk-slides-velis_CC0.pptx")));
  });
  it.each([["canonical"], ["alien"]])("%s renders an emphasized + region-split slide", async (which) => {
    const tpl = which === "canonical" ? canonical : alien;
    const edited = applyDesignIntent(coexistSlide(), [
      { op: "regionSplit", arrangement: "text-right" },
      { op: "emphasize", nodeId: "A", level: "medium" },
    ]);
    const buf = await generatePptx({ slides: [edited] }, tpl);
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).some((f) => /ppt\/slides\/slide1\.xml$/.test(f))).toBe(true);
  });
});
