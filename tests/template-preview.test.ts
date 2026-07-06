/**
 * template-preview.test.ts — the pure data path behind the TemplateCreator's in-modal live preview
 * (increment 1). buildTemplatePreview(spec) must round-trip a TemplateSpec through the REAL engine
 * (writeTemplate → loadTemplate → distill a sample deck) so the modal preview is WYSIWYG with the
 * generated template. Also covers the layout-subset data path (increment 2).
 */
import { describe, it, expect } from "vitest";
import { buildTemplatePreview, combineLayouts } from "../src/components/template-preview";
import { MIDNIGHT_PALETTE, type TemplateSpec } from "../src/engine/template-writer";
import { BUILTIN_LAYOUTS, type LayoutDef } from "../src/engine/template-layout-library";
import { assessTemplateHealth, buildCatalog } from "../src/engine/template-catalog";

const spec = (over: Partial<TemplateSpec> = {}): TemplateSpec => ({
  name: "T",
  fonts: { major: "Georgia", minor: "Calibri" },
  palette: { ...MIDNIGHT_PALETTE },
  ...over,
});

describe("buildTemplatePreview", () => {
  it("produces a multi-slide sample deck + the full 30-layout template from a spec", async () => {
    const { deck, template } = await buildTemplatePreview(spec());
    expect(deck.slides.length).toBeGreaterThanOrEqual(3);
    expect(template.layouts.length).toBe(30);
  });

  it("flows a changed palette colour into the rendered template (proves the preview is LIVE)", async () => {
    const { template } = await buildTemplatePreview(spec({ palette: { ...MIDNIGHT_PALETTE, background: "AB12CD" } }));
    // the distinctive colour must appear somewhere in the generated/loaded template (bg fill / deco)
    expect(JSON.stringify(template).toUpperCase()).toContain("AB12CD");
  });

  it("honours a layout SUBSET (increment 2 data path — emits only the chosen layouts)", async () => {
    const subset = BUILTIN_LAYOUTS.slice(0, 3);
    const { template } = await buildTemplatePreview(spec({ layouts: subset }));
    expect(template.layouts.map((l) => l.name)).toEqual(subset.map((l) => l.name));
  });

  it("the full-30 preview passes the acceptance gate the create button reuses (not spuriously blocked)", async () => {
    // The modal disables 生成して適用 when assessTemplateHealth(buildCatalog(previewTemplate)) is
    // rejected; the default (all 30) must NOT be rejected or creation would be impossible by default.
    const { template } = await buildTemplatePreview(spec());
    expect(assessTemplateHealth(buildCatalog(template)).status).not.toBe("rejected");
  });

  it("showcases a CUSTOM layout (increment 3) — generates it AND pins a preview slide to it", async () => {
    const custom: LayoutDef = {
      name: "カスタムA",
      family: "light",
      placeholders: [
        { name: "Title", type: "ctrTitle", idx: 0, x: 1.2, y: 0.8, w: 10.5, h: 1.2, fontSize: 40, font: "major", color: "titleText", bold: true, align: "l" },
        { name: "Body", type: "body", idx: 1, x: 1.2, y: 2.2, w: 10.5, h: 4.5, fontSize: 18, font: "minor", color: "bodyText", bold: false, align: "l" },
      ],
    };
    const { deck, template } = await buildTemplatePreview(spec({ layouts: [...BUILTIN_LAYOUTS, custom] }), ["カスタムA"]);
    expect(template.layouts.map((l) => l.name)).toContain("カスタムA");
    expect(deck.slides.some((s) => s.layout === "カスタムA")).toBe(true); // pinned showcase slide present
  });
});

describe("combineLayouts", () => {
  const mkCustom = (name: string): LayoutDef => ({
    name,
    family: "light",
    placeholders: [{ name: "Title", type: "ctrTitle", idx: 0, x: 1.2, y: 0.8, w: 10.5, h: 1.2, fontSize: 40, font: "major", color: "titleText", bold: true, align: "l" }],
  });

  it("guarantees unique, non-empty layout names (disambiguates a built-in collision + fills a blank)", () => {
    const builtins = BUILTIN_LAYOUTS.slice(0, 2);
    const collide = mkCustom(builtins[0].name); // collides with a built-in
    const blank = mkCustom("   "); // empty after trim
    const { layouts, customNames } = combineLayouts(builtins, [collide, blank]);
    // no duplicate names anywhere
    expect(new Set(layouts.map((l) => l.name)).size).toBe(layouts.length);
    expect(customNames[0]).toBe(`${builtins[0].name} (2)`); // collision → suffixed
    expect(customNames[1]).toBe("カスタム2"); // blank → positional default
    // every pinned custom name actually exists in the combined list (so the showcase pin resolves to it)
    for (const n of customNames) expect(layouts.some((l) => l.name === n)).toBe(true);
  });

  it("passes distinct names through unchanged and preserves built-in order first", () => {
    const builtins = BUILTIN_LAYOUTS.slice(0, 1);
    const { layouts, customNames } = combineLayouts(builtins, [mkCustom("マイ独自")]);
    expect(layouts[0].name).toBe(builtins[0].name);
    expect(customNames).toEqual(["マイ独自"]);
  });
});
