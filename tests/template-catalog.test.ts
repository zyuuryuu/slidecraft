/**
 * template-catalog.test.ts — Semantic catalog derived from the slide master.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, pickLayout, layoutRole, type LayoutCatalog } from "../src/engine/template-catalog";
import type { SlideIR } from "../src/engine/slide-schema";

function mk(overrides: Partial<SlideIR>): SlideIR {
  return { layout: "auto", placeholders: [], ...overrides };
}
const ph = (idx: string, text = "x") => ({ idx, paragraphs: [{ segments: [{ text }] }] });

const TEMPLATE_PATH = resolve(
  __dirname,
  "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx",
);

let tpl: TemplateData;
let catalog: LayoutCatalog;

beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(TEMPLATE_PATH));
  catalog = buildCatalog(tpl);
});

describe("layoutRole", () => {
  it("maps the name family to a role", () => {
    expect(layoutRole("Content.1Body.Single")).toBe("content");
    expect(layoutRole("Column.2Body.Equal")).toBe("columns");
    expect(layoutRole("Section.1Title.Single")).toBe("section");
    expect(layoutRole("SectionBreak.1Title.Single")).toBe("section");
    expect(layoutRole("Closing.1Message.Single")).toBe("closing");
    expect(layoutRole("KPI.3Value.Equal")).toBe("kpi");
    expect(layoutRole("Title.1Title.Single")).toBe("title");
  });
});

describe("buildCatalog", () => {
  it("classifies every layout (one entry each)", () => {
    expect(catalog).toHaveLength(tpl.layouts.length);
  });

  it("Content.1Body.Single → content, 1 body, has title + subtitle", () => {
    const e = catalog.find((c) => c.name === "Content.1Body.Single")!;
    expect(e.role).toBe("content");
    expect(e.bodyCount).toBe(1);
    expect(e.hasTitle).toBe(true);
    expect(e.placeholders.some((p) => p.role === "body")).toBe(true);
  });

  it("Column layouts have the right body counts", () => {
    expect(catalog.find((c) => c.name === "Column.2Body.Equal")!.bodyCount).toBe(2);
    expect(catalog.find((c) => c.name === "Column.3Body.Equal")!.bodyCount).toBe(3);
  });

  it("Section layout is a title-only divider (0 body)", () => {
    const e = catalog.find((c) => c.name === "Section.1Title.Single")!;
    expect(e.role).toBe("section");
    expect(e.bodyCount).toBe(0);
  });

  it("Title layout exposes a title placeholder", () => {
    const e = catalog.find((c) => c.name === "Title.1Title.Single")!;
    expect(e.role).toBe("title");
    expect(e.hasTitle).toBe(true);
  });
});

describe("pickLayout", () => {
  it("picks the simplest content layout for 1 region", () => {
    const e = pickLayout(catalog, "content", 1)!;
    expect(e.role).toBe("content");
    expect(e.bodyCount).toBe(1);
    expect(e.name).toBe("Content.1Body.Single"); // simplest, no +addon
  });

  it("picks 2- and 3-column layouts by region count", () => {
    expect(pickLayout(catalog, "columns", 2)!.bodyCount).toBe(2);
    expect(pickLayout(catalog, "columns", 3)!.bodyCount).toBe(3);
  });

  it("picks a closing and a title layout", () => {
    expect(pickLayout(catalog, "closing")!.role).toBe("closing");
    expect(pickLayout(catalog, "title")!.role).toBe("title");
  });

  it("returns undefined for a role the template lacks", () => {
    const empty = buildCatalog({ ...tpl, layouts: [] });
    expect(pickLayout(empty, "content", 1)).toBeUndefined();
  });
});

describe("placeholder capacity", () => {
  it("a body placeholder has a positive char capacity", () => {
    const e = catalog.find((c) => c.name === "Content.1Body.Single")!;
    const body = e.placeholders.find((p) => p.role === "body")!;
    expect(body.capacity).toBeGreaterThan(0);
  });
});

describe("autoSelectLayout parity (catalog === hardcoded for the canonical template)", () => {
  const slides: Array<[string, SlideIR, number, number]> = [
    ["title (first)", mk({ placeholders: [ph("15", "T")] }), 0, 6],
    ["content", mk({ placeholders: [ph("15", "T"), ph("1", "body")] }), 1, 6],
    ["2 columns", mk({ placeholders: [ph("15"), ph("1"), ph("2")] }), 1, 6],
    ["3 columns", mk({ placeholders: [ph("15"), ph("1"), ph("2"), ph("3")] }), 1, 6],
    ["section", mk({ placeholders: [ph("15", "Section")] }), 1, 6],
    ["closing", mk({ placeholders: [ph("0", "Thank you")] }), 5, 6],
  ];
  it.each(slides)("%s → same layout with and without the catalog", (_name, slide, i, total) => {
    expect(autoSelectLayout(slide, i, total, catalog)).toBe(autoSelectLayout(slide, i, total));
  });
});
