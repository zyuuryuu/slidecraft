/**
 * master-remake.test.ts — the "Re-make" intake mode: extract a company master's theme (fonts + colors)
 * and re-emit SlideCraft's canonical layouts wearing it. Coexists with faithful Import. Proves the
 * round-trip (extract → writeTemplate → loadTemplate) yields a HEALTHY, contrast-safe template that
 * fills content — dissolving the third-party idx/contrast quirks from ADR-0023 by construction.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { masterToTemplateSpec } from "../src/engine/master-remake";
import { writeTemplate } from "../src/engine/template-writer";
import { buildCatalog, assessTemplateHealth } from "../src/engine/template-catalog";
import { generatePptx } from "../src/engine/placeholder-filler";
import { parseMd } from "../src/engine/md-parser";
import { luminance } from "../src/engine/ooxml-resolve";

const CX = resolve(__dirname, "../public/templates/slide/CX_sample_MSGothic.pptx");
const contrast = (a: string, b: string) => Math.abs(luminance(a) - luminance(b));

describe("masterToTemplateSpec — extract theme from a real master", () => {
  let cx: TemplateData;
  beforeAll(async () => {
    cx = await loadTemplate(readFileSync(CX));
  });

  it("carries the company's fonts", () => {
    const spec = masterToTemplateSpec(cx);
    expect(spec.fonts.major).toMatch(/gothic/i); // CX is MS Gothic
    expect(spec.fonts.minor).toMatch(/gothic/i);
  });

  it("maps a light canvas + a dark brand background", () => {
    const spec = masterToTemplateSpec(cx);
    expect(spec.palette.canvas).toBe("FFFFFF"); // CX's real master bg (inverted theme handled)
    expect(luminance(spec.palette.background)).toBeLessThan(0.5); // a dark brand color for dark layouts
  });

  it("maps colors CONTRAST-SAFELY (no invisible text by construction)", () => {
    const p = masterToTemplateSpec(cx).palette;
    expect(contrast(p.titleText, p.background)).toBeGreaterThan(0.3); // title on dark header/bg
    expect(contrast(p.bodyText, p.canvas)).toBeGreaterThan(0.3); // body on the light canvas
    expect(contrast(p.emphasis, p.canvas)).toBeGreaterThan(0.2); // emphasis on the canvas
    expect(contrast(p.subtle, p.background)).toBeGreaterThan(0.2); // subtitle on the dark bg
  });
});

describe("Re-make round-trip — the minted template is healthy + fills content", () => {
  let remade: TemplateData;
  beforeAll(async () => {
    const cx = await loadTemplate(readFileSync(CX));
    const bytes = await writeTemplate(masterToTemplateSpec(cx, { name: "CX Re-make" }));
    remade = await loadTemplate(bytes);
  });

  it("passes the acceptance gate (not rejected)", () => {
    const health = assessTemplateHealth(buildCatalog(remade));
    expect(health.status).not.toBe("rejected");
  });

  it("uses SlideCraft's canonical convention (dotted names) — no idx ambiguity", () => {
    // The re-made template IS canonical, so its content body sits at idx 1 (well-controlled).
    expect(remade.layouts.some((l) => /\.\d/.test(l.name))).toBe(true);
  });

  it("END-TO-END: a content deck fills + renders on the re-made template", async () => {
    const deck = parseMd("# 事業計画\n## レビュー\n\n---\n\n# 今期の柱\n\n- 品質を上げる\n- 速度を上げる\n");
    const buf = await generatePptx(deck, remade);
    const zip = await JSZip.loadAsync(buf);
    const s2 = (await zip.file("ppt/slides/slide2.xml")?.async("string")) ?? "";
    expect(s2).toContain("今期の柱");
    expect(s2).toContain("品質を上げる");
  });
});
