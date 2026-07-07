/**
 * layout-enumeration.test.ts — the loader must enumerate the slideLayout parts that ACTUALLY exist,
 * not assume contiguous numbering. Regression: some templates (e.g. Claude-generated) number layouts
 * with gaps (1-6,8,12-17); the old "break on the first missing number" loop dropped every layout
 * after the first gap — here 7 of 13, so KPI/章扉/プロセス/… became unusable in preview AND export.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";

const GAPPED = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");
const CONTIGUOUS = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

describe("slideLayout enumeration is gap-tolerant", () => {
  it("loads ALL layouts even when file numbers are non-contiguous (1-6,8,12-17)", async () => {
    const tpl = await loadTemplate(readFileSync(GAPPED));
    const indices = tpl.layouts.map((l) => l.index).sort((a, b) => a - b);
    expect(indices).toEqual([1, 2, 3, 4, 5, 6, 8, 12, 13, 14, 15, 16, 17]);
    // Layouts past the first numbering gap (7) must survive — e.g. the KPI layout at index 13.
    expect(tpl.layouts.some((l) => l.index >= 8)).toBe(true);
    expect(tpl.layouts.length).toBe(13);
  });

  it("still loads a contiguous template (no regression)", async () => {
    const tpl = await loadTemplate(readFileSync(CONTIGUOUS));
    expect(tpl.layouts.length).toBe(30);
    expect(tpl.layouts[0].index).toBe(1);
  });
});
