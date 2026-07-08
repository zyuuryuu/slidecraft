/**
 * Tier-2 layout-selection reinforcement — the degrade tail. When a template lacks a content/columns
 * role, autoSelectLayout used to fall to catalog[0] (the FIRST layout by file order) — a positional,
 * order-dependent pick. Now it degrades across the other body-bearing roles and, as a last resort,
 * ranks by body SUITABILITY (not file order). Gated: only fires when no content/columns layout exists,
 * so canonical/healthy templates (which always expose content) are byte-identical.
 * Also: an image slide with no picture-frame layout now deterministically prefers a writable body.
 */
import { describe, it, expect } from "vitest";
import { autoSelectLayout } from "../src/engine/template-loader";
import { type CatalogEntry, type CatalogPlaceholder } from "../src/engine/template-catalog";
import type { SlideIR } from "../src/engine/slide-schema";

const catPh = (idx: string, role: string, usable = true): CatalogPlaceholder =>
  ({ idx, role, order: 1, capacity: usable ? 100 : 0, charsPerLine: usable ? 40 : 0, maxLines: usable ? 5 : 0 }) as never;
const entry = (name: string, role: string, phs: CatalogPlaceholder[], bodyCount = phs.filter((p) => (p as never as { role: string; charsPerLine: number }).role === "body" && (p as never as { charsPerLine: number }).charsPerLine > 0).length): CatalogEntry =>
  ({ name, role, bodyCount, hasTitle: true, hasSubtitle: false, placeholders: phs }) as never;
const seg = (t: string) => ({ segments: [{ text: t }] });
const slide = (phs: Array<{ idx: string; text: string }>, extra: Record<string, unknown> = {}): SlideIR =>
  ({ layout: "auto", placeholders: phs.map((p) => ({ idx: p.idx, paragraphs: [seg(p.text)] })), ...extra }) as never;
const imgSlide = (phs: Array<{ idx: string; text: string }>): SlideIR =>
  slide(phs, { image: { src: "data:image/png;base64,AAA", alt: "x" } });

describe("Tier-2: degrade tail replaces the positional catalog[0] with a suitability pick", () => {
  it("no content/columns role → picks a body-bearing layout, NOT the first-by-order title layout", () => {
    // A first-listed Title (no body) + a body-bearing Code layout. Content slide must land on Code.
    const cat: CatalogEntry[] = [
      entry("00_Title", "title", [catPh("15", "title"), catPh("16", "subtitle")], 0),
      entry("07_Code", "code", [catPh("15", "title"), catPh("1", "body")]),
    ];
    const s = slide([{ idx: "15", text: "手順" }, { idx: "1", text: "- a\n- b" }]);
    expect(autoSelectLayout(s, 2, 5, cat)).toBe("07_Code");
  });

  it("order-independent: same pick when the body-bearing layout is listed FIRST", () => {
    const cat: CatalogEntry[] = [
      entry("07_Code", "code", [catPh("15", "title"), catPh("1", "body")]),
      entry("00_Title", "title", [catPh("15", "title"), catPh("16", "subtitle")], 0),
    ];
    const s = slide([{ idx: "15", text: "手順" }, { idx: "1", text: "- a\n- b" }]);
    expect(autoSelectLayout(s, 2, 5, cat)).toBe("07_Code");
  });

  it("prefers the body-bearing layout whose region count best fits (1-region content → 1-body)", () => {
    const cat: CatalogEntry[] = [
      entry("Title", "title", [catPh("15", "title")], 0),
      entry("Table3", "table", [catPh("15", "title"), catPh("1", "body"), catPh("2", "body"), catPh("3", "body")]),
      entry("Note1", "code", [catPh("15", "title"), catPh("1", "body")]),
    ];
    const s = slide([{ idx: "15", text: "x" }, { idx: "1", text: "- a" }]); // content, regions=1
    expect(autoSelectLayout(s, 2, 5, cat)).toBe("Note1");
  });

  it("truly no body anywhere → still returns a layout (falls back to catalog[0], no crash)", () => {
    const cat: CatalogEntry[] = [
      entry("Title", "title", [catPh("15", "title")], 0),
      entry("Divider", "section", [catPh("15", "title")], 0),
    ];
    const s = slide([{ idx: "15", text: "x" }, { idx: "1", text: "a" }]);
    expect(["Title", "Divider"]).toContain(autoSelectLayout(s, 2, 5, cat));
  });
});

describe("Tier-2: image slide with no picture frame prefers a writable body", () => {
  it("picks the usable-body content layout over a degenerate zero-line body", () => {
    const cat: CatalogEntry[] = [
      entry("PicOnly", "content", [catPh("15", "title"), catPh("1", "body", /* usable */ false)], 1),
      entry("TextContent", "content", [catPh("15", "title"), catPh("1", "body")]),
    ];
    const s = imgSlide([{ idx: "15", text: "図" }]);
    expect(autoSelectLayout(s, 2, 5, cat)).toBe("TextContent");
  });

  it("still prefers a real picture frame when one exists", () => {
    const cat: CatalogEntry[] = [
      entry("TextContent", "content", [catPh("15", "title"), catPh("1", "body")]),
      entry("PicFrame", "content", [catPh("15", "title"), catPh("1", "picture")], 0),
    ];
    const s = imgSlide([{ idx: "15", text: "図" }]);
    expect(autoSelectLayout(s, 2, 5, cat)).toBe("PicFrame");
  });
});
