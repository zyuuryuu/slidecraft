/**
 * theme-color.test.ts — the preview reads placeholder text color, which most real templates set via
 * `schemeClr` (a theme reference), not an explicit `srgbClr`. Regression: an unresolved theme color
 * fell back to the white master-title default → a white-on-white, invisible title on the preview.
 * The loader must resolve schemeClr → hex; the canonical (which bakes srgbClr) must stay unchanged.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";
import { placeholderRole } from "../src/engine/template-catalog";

const ROOT = "fixtures/templates";
const load = (f: string) => loadTemplate(readFileSync(resolve(__dirname, `${ROOT}/${f}`)));

function titleColorOf(tpl: Awaited<ReturnType<typeof loadTemplate>>, layoutName: string): string | undefined {
  const layout = tpl.layouts.find((l) => l.name === layoutName);
  return layout?.placeholders.find((p) => placeholderRole(p) === "title")?.style.fontColor;
}

describe("theme-color resolution (schemeClr → hex) for the preview", () => {
  it("resolves an alien master's theme-colored title instead of the white fallback", async () => {
    const velis = await load("lrk-slides-velis_CC0.pptx");
    // velis colors its content-layout titles via `schemeClr accent1` on a WHITE background.
    const bg = velis.masterBgColor;
    const title = titleColorOf(velis, "Title and Content");
    expect(title).toBeDefined();
    expect(title).not.toBe("FFFFFF"); // NOT white — it was invisible on the white bg before
    expect(title).not.toBe(bg); // and not the background color either → actually visible
  });

  it("leaves the canonical (explicit srgbClr) master unchanged", async () => {
    const canon = await load("Midnight_Executive_30_TemplateOnly.pptx");
    expect(canon.masterBgColor).toBe("FFFFFF");
    // The canonical bakes explicit srgbClr; srgbClr still wins over any schemeClr path.
    expect(canon.masterTitleStyle.fontColor).toBe("FFFFFF");
  });
});
