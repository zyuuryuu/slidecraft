/**
 * alien-template.test.ts — GUARDRAIL: the harness must work with ANY slide master,
 * not just the canonical one. Uses a structurally-different CC0 template (different
 * layout names, placeholder idxs, two masters) to prove template-independence.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, classifyLayout, type LayoutCatalog } from "../src/engine/template-catalog";
import { contentBodyBox, distillDeck } from "../src/engine/distill";
import { generatePptx } from "../src/engine/placeholder-filler";
import { parseMd } from "../src/engine/md-parser";
import type { SlideIR } from "../src/engine/slide-schema";

const ALIEN = resolve(__dirname, "fixtures/templates/lrk-slides-velis_CC0.pptx");
const mk = (phs: SlideIR["placeholders"]): SlideIR => ({ layout: "auto", placeholders: phs });
const ph = (idx: string, t = "x") => ({ idx, paragraphs: [{ segments: [{ text: t }] }] });

describe("classifyLayout (name-agnostic: dotted → keywords → structure)", () => {
  const noPh = { hasTitle: true, hasSubtitle: false, bodyCount: 0 };
  it("keeps the canonical dotted convention", () => {
    expect(classifyLayout("Content.1Body.Single", { ...noPh, bodyCount: 1 })).toBe("content");
    expect(classifyLayout("Column.2Body.Equal", { ...noPh, bodyCount: 2 })).toBe("columns");
  });
  it("recognizes plain-language real template names", () => {
    expect(classifyLayout("Title and Content", { ...noPh, bodyCount: 1 })).toBe("content");
    expect(classifyLayout("Two Columns", { ...noPh, bodyCount: 2 })).toBe("columns");
    expect(classifyLayout("Two Content", { ...noPh, bodyCount: 2 })).toBe("columns");
    expect(classifyLayout("Section Title", noPh)).toBe("section");
    expect(classifyLayout("Presentation Title", { hasTitle: true, hasSubtitle: true, bodyCount: 0 })).toBe("title");
    expect(classifyLayout("Comparison", { ...noPh, bodyCount: 2 })).toBe("columns");
  });
  it("falls back to placeholder STRUCTURE when the name says nothing", () => {
    expect(classifyLayout("Layout 7", { hasTitle: true, hasSubtitle: false, bodyCount: 1 })).toBe("content");
    expect(classifyLayout("Custom", { hasTitle: true, hasSubtitle: false, bodyCount: 3 })).toBe("columns");
    expect(classifyLayout("Custom", { hasTitle: true, hasSubtitle: true, bodyCount: 0 })).toBe("title");
    expect(classifyLayout("Custom", { hasTitle: true, hasSubtitle: false, bodyCount: 0 })).toBe("section");
  });
});

describe("alien CC0 template flows through the harness", () => {
  let tpl: TemplateData;
  let cat: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(ALIEN));
    cat = buildCatalog(tpl);
  });

  it("loads and classifies layouts (NOT all 'other')", () => {
    expect(tpl.layouts.length).toBeGreaterThan(5);
    const roles = new Set(cat.map((e) => e.role));
    expect(roles.has("content")).toBe(true);
    expect(roles.has("title")).toBe(true);
    // the catalog must surface real content/column layouts, not collapse to "other"
    expect(cat.filter((e) => e.role === "other").length).toBeLessThan(cat.length);
  });

  it("placeholder roles come from TYPE, robust to the alien idx convention", () => {
    // some layout must expose a title + a body bound by role despite different idxs
    expect(cat.some((e) => e.hasTitle)).toBe(true);
    expect(cat.some((e) => e.bodyCount >= 1)).toBe(true);
  });

  it("autoSelectLayout picks role-appropriate layouts, not the title fallback", () => {
    const title = autoSelectLayout(mk([ph("15", "T")]), 0, 5, cat);
    const content = autoSelectLayout(mk([ph("15", "T"), ph("1", "body")]), 1, 5, cat);
    expect(content).not.toBe(title); // content must NOT collapse onto the title layout
    expect(cat.find((e) => e.name === content)?.role).toBe("content");
  });

  it("loads ALL slideLayouts across masters (no hardcoded 30 cap)", () => {
    // lrk-slides has 32 layouts over 2 masters; the old `i <= 30` dropped 31/32.
    expect(tpl.layouts.length).toBe(32);
  });

  it("contentBodyBox returns a USABLE text box — picks a text layout, not a picture one", () => {
    // The alien template has picture layouts ("Two Pictures", maxLines 0) tied at
    // bodyCount 1; pickLayout must avoid them so the SPLIT lever has a real box.
    const box = contentBodyBox(cat);
    expect(box).toBeDefined();
    expect(box!.maxLines).toBeGreaterThan(0);
    const single = autoSelectLayout(mk([ph("15", "T"), ph("1", "body")]), 1, 5, cat);
    expect(single).not.toMatch(/picture|^one |^two pictures/i);
  });

  it("SPLIT lever fires on the alien template (overflow → more slides)", () => {
    const bullets = Array.from({ length: 30 }, (_, i) => `- 項目${i} の説明テキストをそれなりの長さで書く`).join("\n");
    const fitted = distillDeck(parseMd(`# 詰め込み\n\n${bullets}`), cat);
    expect(fitted.slides.length).toBeGreaterThan(1);
  });

  it("degrades an explicit layout name the alien template lacks (no crash)", () => {
    // A deck pinned to canonical names must NOT crash on a different master —
    // autoSelectLayout falls back through the catalog instead of returning the
    // unmatched name (which findLayout would later reject).
    const pinned = mk([ph("15", "T"), ph("1", "L"), ph("2", "R")]);
    pinned.layout = "Column.2Body.Equal"; // not present in the alien template
    const resolved = autoSelectLayout(pinned, 1, 5, cat);
    expect(cat.some((e) => e.name === resolved)).toBe(true); // a REAL alien layout
    expect(resolved).not.toBe("Column.2Body.Equal");
  });

  it("renders a deck pinned to canonical layout names on the alien template (no crash)", async () => {
    const deck = parseMd("<!-- slide: Content.1Body.Single -->\n# 背景\n\n- A\n- B\n");
    const buf = await generatePptx(deck, tpl);
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).some((f) => /ppt\/slides\/slide1\.xml$/.test(f))).toBe(true);
  });

  it("generates a valid PPTX on the alien template (end-to-end, no crash)", async () => {
    const deck = parseMd("# 提案\n## 副題\n\n---\n\n# 背景\n\n- 要点A\n- 要点B\n\n---\n\n# まとめ\n");
    const buf = await generatePptx(deck, tpl);
    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides.length).toBe(deck.slides.length);
  });
});
