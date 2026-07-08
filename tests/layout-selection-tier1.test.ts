/**
 * Tier-1 layout-selection reinforcement (mirrors ADR-0025's gated philosophy for layouts):
 *  1. Closing detection shares the classifier's vocabulary, is title-scoped + word-anchored (no
 *     body "thank" false-positive), gated to the last slide (degrades to content if no closing layout).
 *  2. classifyLayout GATE 1/2 — GEOMETRY-BACKED peer columns beat a misleading name; a "columns" name
 *     with <2 real bodies falls back to structure. A layout with 2 non-peer bodies is NEVER forced to
 *     columns (the reviewer's concern).
 *  3. A body-only FIRST slide is not coerced into the cover (title) role.
 * All gates keep canonical (dotted-name) templates byte-identical.
 */
import { describe, it, expect } from "vitest";
import { classifyLayout, type CatalogEntry, type CatalogPlaceholder } from "../src/engine/template-catalog";
import { autoSelectLayout } from "../src/engine/template-loader";
import type { SlideIR } from "../src/engine/slide-schema";

// ── helpers ──
type Box = { x: number; y: number; w: number; h: number };
const info = (o: Partial<{ hasTitle: boolean; hasSubtitle: boolean; bodyCount: number; bodyBoxes: Box[] }>) => ({
  hasTitle: true, hasSubtitle: false, bodyCount: 0, ...o,
});
// two genuine side-by-side, top-aligned, equal-size columns
const peerCols: Box[] = [{ x: 0.5, y: 1.5, w: 5.8, h: 4.5 }, { x: 7.0, y: 1.5, w: 5.8, h: 4.5 }];
// two STACKED bodies (same x, different y) — NOT peers
const stacked: Box[] = [{ x: 0.5, y: 1.5, w: 12, h: 2.2 }, { x: 0.5, y: 4.0, w: 12, h: 2.2 }];
// primary + narrow sidebar — NOT peers (width ratio too small)
const primarySidebar: Box[] = [{ x: 0.5, y: 1.5, w: 9.0, h: 4.5 }, { x: 10.0, y: 1.5, w: 2.6, h: 4.5 }];

const catPh = (idx: string, role: string, usable = true): CatalogPlaceholder =>
  ({ idx, role, order: 1, capacity: usable ? 100 : 0, charsPerLine: usable ? 40 : 0, maxLines: usable ? 5 : 0 }) as never;
const entry = (name: string, role: string, phs: CatalogPlaceholder[], bodyCount = phs.filter((p) => (p as never as { role: string }).role === "body").length): CatalogEntry =>
  ({ name, role, bodyCount, hasTitle: true, hasSubtitle: false, placeholders: phs }) as never;

const seg = (text: string) => ({ segments: [{ text }] });
const slide = (phs: Array<{ idx: string; text: string }>): SlideIR =>
  ({ layout: "auto", placeholders: phs.map((p) => ({ idx: p.idx, paragraphs: [seg(p.text)] })) }) as never;

describe("Tier-1: classifyLayout GATE 1/2 (geometry-backed, ADR-0025-style)", () => {
  it("GATE 1: 2 genuine PEER bodies override a misleading section/agenda name → columns", () => {
    expect(classifyLayout("Section Divider", info({ bodyCount: 2, bodyBoxes: peerCols }))).toBe("columns");
    expect(classifyLayout("Agenda", info({ bodyCount: 2, bodyBoxes: peerCols }))).toBe("columns");
  });

  it("reviewer's concern — 2 BODY placeholders that are NOT peers are NEVER forced to columns", () => {
    // stacked (vertical) → not columns; the name wins as before
    expect(classifyLayout("Section", info({ bodyCount: 2, bodyBoxes: stacked }))).toBe("section");
    // primary + sidebar → not peers → not columns
    expect(classifyLayout("Section", info({ bodyCount: 2, bodyBoxes: primarySidebar }))).toBe("section");
    // NO geometry (inherited xfrm) + bodyCount 2 → GATE must NOT fire; name keyword wins
    expect(classifyLayout("Section", info({ bodyCount: 2 }))).toBe("section");
  });

  it("GATE 2: a 'columns' NAME with <2 real bodies falls back to structure (content), not columns", () => {
    expect(classifyLayout("Two Content", info({ bodyCount: 1, bodyBoxes: [{ x: 0.5, y: 1.5, w: 12, h: 5 }] }))).toBe("content");
    expect(classifyLayout("Comparison", info({ bodyCount: 1 }))).toBe("content");
  });

  it("canonical dotted-name layouts are byte-identical (T1 wins over the gates)", () => {
    // A dotted family name resolves by layoutRole regardless of structure — unchanged.
    expect(classifyLayout("Section.1Divider.Single", info({ bodyCount: 2, bodyBoxes: peerCols }))).toBe("section");
    expect(classifyLayout("Content.1Body.Single", info({ bodyCount: 1 }))).toBe("content");
  });

  it("plain content/section names without conflicting geometry are unchanged", () => {
    expect(classifyLayout("Section Header", info({ bodyCount: 0 }))).toBe("section");
    expect(classifyLayout("Body Text", info({ bodyCount: 1 }))).toBe("content");
  });
});

describe("Tier-1: closing detection (shared vocab, title-scoped, gated)", () => {
  const cat: CatalogEntry[] = [
    entry("Closing", "closing", [catPh("15", "title")]),
    entry("Content", "content", [catPh("15", "title"), catPh("1", "body")]),
  ];
  it("a last slide titled with the shared closing vocab routes to the closing layout", () => {
    expect(autoSelectLayout(slide([{ idx: "15", text: "まとめと今後の展望" }]), 4, 5, cat)).toBe("Closing");
    expect(autoSelectLayout(slide([{ idx: "15", text: "Next steps" }]), 4, 5, cat)).toBe("Closing");
    expect(autoSelectLayout(slide([{ idx: "15", text: "ご清聴ありがとうございました" }]), 4, 5, cat)).toBe("Closing");
  });
  it("FALSE-POSITIVE fixed: a last slide whose BODY mentions 'thank' but whose TITLE isn't closing → content", () => {
    const s = slide([{ idx: "15", text: "実施結果" }, { idx: "1", text: "We thank the pilot team for the data; results below" }]);
    expect(autoSelectLayout(s, 4, 5, cat)).toBe("Content");
  });
  it("a mid-deck 'まとめ' slide (not last) is NOT closing", () => {
    expect(autoSelectLayout(slide([{ idx: "15", text: "まとめ" }, { idx: "1", text: "x" }]), 2, 5, cat)).toBe("Content");
  });
  it("no closing layout in the template → a まとめ last slide degrades to content (no crash)", () => {
    const noClosing: CatalogEntry[] = [entry("Content", "content", [catPh("15", "title"), catPh("1", "body")])];
    expect(autoSelectLayout(slide([{ idx: "15", text: "まとめ" }, { idx: "1", text: "x" }]), 4, 5, noClosing)).toBe("Content");
  });
});

describe("Tier-1: a simple bullet list prefers the FEWEST-body content layout (reviewer's concern)", () => {
  // A template offering a 1-body content layout, a 2-body content layout, AND a 2-col columns layout.
  const cat: CatalogEntry[] = [
    entry("Cover", "title", [catPh("15", "title"), catPh("16", "subtitle")], 0),
    entry("OneBody", "content", [catPh("15", "title"), catPh("1", "body")]),
    entry("TwoBody", "content", [catPh("15", "title"), catPh("1", "body"), catPh("2", "body")]),
    entry("TwoCol", "columns", [catPh("15", "title"), catPh("1", "body"), catPh("2", "body")]),
  ];
  const bullets = slide([{ idx: "15", text: "要点" }, { idx: "1", text: "項目A\n項目B\n項目C" }]);
  it("→ the 1-body content layout, never the multi-body content or the columns layout", () => {
    expect(autoSelectLayout(bullets, 2, 5, cat)).toBe("OneBody");
  });
  it("order-independent: still the 1-body layout even if it's listed last", () => {
    const reordered: CatalogEntry[] = [cat[0], cat[2], cat[3], cat[1]]; // OneBody moved to the end
    expect(autoSelectLayout(bullets, 2, 5, reordered)).toBe("OneBody");
  });
});

describe("Tier-1: body-only first slide is not coerced to the cover", () => {
  const cat: CatalogEntry[] = [
    entry("Cover", "title", [catPh("15", "title"), catPh("16", "subtitle")], 0),
    entry("Content", "content", [catPh("15", "title"), catPh("1", "body")]),
  ];
  it("a first slide with ONLY body bullets (no title) → content, not the cover", () => {
    expect(autoSelectLayout(slide([{ idx: "1", text: "箇条書きだけ・タイトルなし" }]), 0, 5, cat)).toBe("Content");
  });
  it("a real cover (title + subtitle, no body) at index 0 still → cover", () => {
    expect(autoSelectLayout(slide([{ idx: "15", text: "表紙" }, { idx: "16", text: "サブ" }]), 0, 5, cat)).toBe("Cover");
  });
  it("a title+body first slide → content (unchanged)", () => {
    expect(autoSelectLayout(slide([{ idx: "15", text: "見出し" }, { idx: "1", text: "本文" }]), 0, 5, cat)).toBe("Content");
  });
});
