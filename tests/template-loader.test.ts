/**
 * template-loader.test.ts — Tests for template PPTX loading and layout registry.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  loadTemplate,
  type TemplateData,
} from "../src/engine/template-loader";
import { autoSelectLayout } from "../src/engine/template-loader";
import type { SlideIR } from "../src/engine/slide-schema";

const TEMPLATE_PATH = resolve(
  __dirname,
  "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx",
);

let tpl: TemplateData;

beforeAll(async () => {
  const buf = readFileSync(TEMPLATE_PATH);
  tpl = await loadTemplate(buf);
});

describe("loadTemplate", () => {
  it("loads 30 layouts", () => {
    expect(tpl.layouts).toHaveLength(30);
  });

  it("each layout has a name and index", () => {
    for (const layout of tpl.layouts) {
      expect(layout.name).toBeTruthy();
      expect(layout.index).toBeGreaterThanOrEqual(1);
      expect(layout.index).toBeLessThanOrEqual(30);
    }
  });

  it("each layout has placeholder info", () => {
    // Layout 7 (Content.1Body.Single) should have placeholders 15, 16, 1, 50
    const l7 = tpl.layouts.find((l) => l.index === 7);
    expect(l7).toBeDefined();
    const idxs = l7!.placeholders.map((p) => p.idx);
    expect(idxs).toContain("15");
    expect(idxs).toContain("16");
    expect(idxs).toContain("1");
  });

  it("layout 1 has ctrTitle placeholder (idx 0)", () => {
    const l1 = tpl.layouts.find((l) => l.index === 1);
    expect(l1).toBeDefined();
    const idxs = l1!.placeholders.map((p) => p.idx);
    expect(idxs).toContain("0");
  });

  it("placeholder shapes contain XML", () => {
    const l7 = tpl.layouts.find((l) => l.index === 7);
    const ph15 = l7!.placeholders.find((p) => p.idx === "15");
    expect(ph15).toBeDefined();
    expect(ph15!.shapeXml).toContain("<p:");
    expect(ph15!.shapeXml.length).toBeGreaterThan(50);
  });

  it("finds layout by name", () => {
    const layout = tpl.layouts.find(
      (l) => l.name === "Content.1Body.Single",
    );
    expect(layout).toBeDefined();
    expect(layout!.index).toBe(7);
  });

  it("preserves presentation.xml and rels for PPTX assembly", () => {
    expect(tpl.presentationXml).toContain("p:presentation");
    expect(tpl.presentationRels).toContain("Relationship");
    expect(tpl.contentTypes).toContain("Types");
  });
});

describe("autoSelectLayout", () => {
  function makeSlide(overrides: Partial<SlideIR>): SlideIR {
    return {
      layout: "auto",
      placeholders: [],
      ...overrides,
    };
  }

  it("selects Title for first slide", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "Title" }] }] },
      ],
    });
    const name = autoSelectLayout(slide, 0, 1);
    expect(name).toMatch(/^Title\./);
  });

  it("selects Section for heading-only slide", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "Section" }] }] },
      ],
    });
    const name = autoSelectLayout(slide, 1, 5);
    expect(name).toMatch(/^Section\./);
  });

  it("selects Content for heading + body", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "Title" }] }] },
        { idx: "1", paragraphs: [{ segments: [{ text: "Body" }] }] },
      ],
    });
    const name = autoSelectLayout(slide, 1, 5);
    expect(name).toMatch(/^Content\./);
  });

  it("selects Column.2Body for 2 content sections", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "Title" }] }] },
        { idx: "1", paragraphs: [{ segments: [{ text: "Left" }] }] },
        { idx: "2", paragraphs: [{ segments: [{ text: "Right" }] }] },
      ],
    });
    const name = autoSelectLayout(slide, 1, 5);
    expect(name).toMatch(/Column\.2Body/);
  });

  it("selects Column.3Body for 3 content sections", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "Title" }] }] },
        { idx: "1", paragraphs: [{ segments: [{ text: "A" }] }] },
        { idx: "2", paragraphs: [{ segments: [{ text: "B" }] }] },
        { idx: "3", paragraphs: [{ segments: [{ text: "C" }] }] },
      ],
    });
    const name = autoSelectLayout(slide, 1, 5);
    expect(name).toMatch(/Column\.3Body/);
  });

  it("selects Closing for last slide with thank keyword", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "0", paragraphs: [{ segments: [{ text: "Thank you" }] }] },
      ],
    });
    const name = autoSelectLayout(slide, 4, 5);
    expect(name).toMatch(/^Closing\./);
  });

  it("returns explicit layout when not auto", () => {
    const slide = makeSlide({ layout: "KPI.3Value.Equal" });
    const name = autoSelectLayout(slide, 0, 1);
    expect(name).toBe("KPI.3Value.Equal");
  });
});
