/**
 * placeholder-binding.test.ts — the shared role-based binding used by BOTH the PPTX export and the
 * live preview (SlideCard). Regression: the preview used to key content by literal idx, so a deck
 * with canonical idxs rendered BLANK on an alien master. Binding by role must place the content
 * into the alien layout's own placeholder idxs — so preview and export agree (WYSIWYG).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { bindContentByRole } from "../src/engine/placeholder-binding";
import type { SlideIR } from "../src/engine/slide-schema";

const ALIEN = resolve(__dirname, "../public/templates/slide/lrk-slides-velis_CC0.pptx");

// A content slide authored with CANONICAL idxs (15=title, 1=body) — what the DeckPlan/sample path emits.
const slide: SlideIR = {
  layout: "auto",
  placeholders: [
    { idx: "15", paragraphs: [{ segments: [{ text: "TITLE_X" }] }] },
    { idx: "1", paragraphs: [{ segments: [{ text: "BODY_X" }], bullet: true }] },
  ],
};

describe("bindContentByRole (preview/export parity on an alien master)", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(ALIEN));
  });

  it("binds canonical-idx content into the ALIEN layout's own placeholder idxs (not blank)", () => {
    const catalog = buildCatalog(tpl);
    const layoutName = autoSelectLayout(slide, 1, 3, catalog); // a content layout in velis
    const layout = findLayout(tpl, layoutName)!;
    expect(layout).toBeDefined();

    const bound = bindContentByRole(slide, layout.placeholders);

    // Content actually lands somewhere — the preview would render it, not a blank card.
    const texts = [...bound.values()].flatMap((c) =>
      c.paragraphs.flatMap((p) => p.segments.map((s) => s.text)));
    expect(texts).toContain("TITLE_X");
    expect(texts).toContain("BODY_X");

    // …and it's bound to the ALIEN layout's real placeholder idxs (role-mapped), which is what the
    // old idx-literal preview lookup missed.
    const layoutIdxs = new Set(layout.placeholders.map((p) => p.idx));
    for (const boundIdx of bound.keys()) expect(layoutIdxs.has(boundIdx)).toBe(true);
  });

  it("puts the title into a title-role placeholder and body into a body-role one", () => {
    const catalog = buildCatalog(tpl);
    const layout = findLayout(tpl, autoSelectLayout(slide, 1, 3, catalog))!;
    const bound = bindContentByRole(slide, layout.placeholders);

    const textAt = (idx: string) =>
      bound.get(idx)?.paragraphs.flatMap((p) => p.segments.map((s) => s.text)).join("") ?? "";
    const titleIdx = [...bound.keys()].find((k) => textAt(k) === "TITLE_X");
    const bodyIdx = [...bound.keys()].find((k) => textAt(k) === "BODY_X");
    expect(titleIdx).toBeDefined();
    expect(bodyIdx).toBeDefined();
    expect(titleIdx).not.toBe(bodyIdx);
  });
});
