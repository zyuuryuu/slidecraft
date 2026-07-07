/**
 * template-preview-fill.test.tsx — the RENDER wiring for the preview polish (A1/A2/A3): a layout's
 * background PICTURE / GRADIENT and a gradient decorative shape must actually reach the rendered
 * output. Drives the SAME SSR path the on-screen preview mounts (renderDeckToHtml → SlideCard), so a
 * green test here means the preview paints them too. No bundled template carries these fills, so we
 * inject them onto a real loaded template and assert the emitted DOM.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderDeckToHtml } from "../src/components/deck-html-export";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";

const CANON = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const DECK = parseMd("# 表紙\n\n- 項目A\n- 項目B");

let tpl: TemplateData;
beforeEach(async () => {
  tpl = await loadTemplate(readFileSync(CANON)); // fresh copy per test (we mutate layouts)
});

describe("preview background fills (A1) reach the SSR render", () => {
  it("paints a layout <p:bg> PICTURE fill as a full-bleed <img> (data: URI)", async () => {
    const SRC = "data:image/png;base64,BRANDCOVER123==";
    tpl.layouts.forEach((l) => { l.backgroundImage = SRC; }); // inject on all → whichever layout is picked has it
    const html = await renderDeckToHtml(DECK, tpl, {});
    expect(html).toContain(`src="${SRC}"`); // full-bleed background image is emitted
    expect(html).toMatch(/object-fit:\s*cover/); // ...as a cover-fit layer
  });

  it("paints a layout <p:bg> GRADIENT fill as a CSS linear-gradient", async () => {
    const GRAD = "linear-gradient(180deg, #112233 0%, #445566 100%)";
    tpl.layouts.forEach((l) => { l.backgroundImage = undefined; l.backgroundGradient = GRAD; });
    const html = await renderDeckToHtml(DECK, tpl, {});
    expect(html).toContain("linear-gradient(180deg, #112233 0%, #445566 100%)");
  });

  it("prefers the master's own <p:bg> image when the layout declares no background", async () => {
    const SRC = "data:image/png;base64,MASTERBG999==";
    tpl.layouts.forEach((l) => { l.background = undefined; l.backgroundImage = undefined; l.backgroundGradient = undefined; });
    tpl.masterBackgroundImage = SRC;
    const html = await renderDeckToHtml(DECK, tpl, {});
    expect(html).toContain(`src="${SRC}"`);
  });
});

describe("preview gradient shapes (A3) reach the SSR render", () => {
  it("renders a gradient-filled decorative shape with its CSS gradient", async () => {
    const GRAD = "linear-gradient(90deg, #0A0A0A 0%, #1A1A1A 100%)";
    tpl.layouts.forEach((l) => { l.decorations = [{ x: 0.5, y: 0.5, w: 4, h: 1, color: "0A0A0A", gradient: GRAD }]; });
    const html = await renderDeckToHtml(DECK, tpl, {});
    expect(html).toContain("linear-gradient(90deg, #0A0A0A 0%, #1A1A1A 100%)");
  });
});
