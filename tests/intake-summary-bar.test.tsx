/**
 * IntakeSummaryBar — the intake-transparency surface (progress during + result after). Locks two things:
 *  1. phaseFraction is a MONOTONIC, honest progress fraction across the intake phases (best-of-N candidates
 *     advance within the generating band; no phase ever regresses) — so the bar can't mislead.
 *  2. the expandable Detail actually renders the AI mapping "why" (source → canonical base + reason), the
 *     data plumbed for exactly this (ADR-0026 §9.1). Rendered via react-dom/server (no click needed).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/i18n"; // init side-effect → useTranslation interpolates (ja default) instead of echoing keys
import { Detail, type IntakeResult } from "../src/components/IntakeSummaryBar";
import { phaseFraction } from "../src/components/apply-template";
import { loadTemplate } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";

const CANON = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

describe("phaseFraction: honest, monotonic progress", () => {
  it("never regresses across phases and best-of-N candidates climb within the generating band", () => {
    const loading = phaseFraction({ phase: "loading" });
    const gen1 = phaseFraction({ phase: "generating", step: 1, total: 2 });
    const gen2 = phaseFraction({ phase: "generating", step: 2, total: 2 });
    const composing = phaseFraction({ phase: "composing" });
    const validating = phaseFraction({ phase: "validating" });
    expect(loading).toBeLessThan(gen1);
    expect(gen1).toBeLessThan(gen2); // candidate 2/2 further than 1/2
    expect(gen2).toBeLessThan(composing); // generating tops out below composing (no overlap)
    expect(composing).toBeLessThan(validating);
    for (const v of [loading, gen1, gen2, composing, validating]) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("Detail: theme + layout previews", () => {
  const result: IntakeResult = {
    mode: "remake",
    name: "会社",
    ts: 0,
    summary: {
      layoutCount: 2,
      status: "ok",
      findings: [],
      theme: { major: "Arial", minor: "游ゴシック", palette: ["#0a1a2f", "#2b6cb0"], logo: true },
    },
  };

  it("renders the extracted theme (fonts + swatches) even without a template", () => {
    const html = renderToStaticMarkup(<Detail result={result} />);
    expect(html).toContain("#0a1a2f"); // swatch background color
    expect(html).toContain("Arial"); // font name (interpolated via i18n)
  });

  it("renders mini WYSIWYG layout previews (SlideCards) when a template is provided", async () => {
    const tpl = await loadTemplate(new Uint8Array(readFileSync(CANON)));
    const sample = parseMd("# T\n\n- a\n- b");
    const name0 = tpl.layouts[0].name;
    const res: IntakeResult = {
      mode: "remake", name: "x", ts: 0,
      summary: { layoutCount: tpl.layouts.length, status: "ok", findings: [], theme: { major: "Arial", minor: "Arial", palette: ["#111"], logo: false } },
    };
    const html = renderToStaticMarkup(<Detail result={res} template={tpl} sample={sample} />);
    expect(html).toContain("プレビュー"); // intake.previewTitle heading
    expect(html).toContain(name0); // the layout's name label under its thumbnail
    expect(html).toContain("208px"); // a LayoutThumb (THUMB_W) with a SlideCard inside actually rendered
  });
});
