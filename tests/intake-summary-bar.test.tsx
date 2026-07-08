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
import { phaseFraction, Detail, type IntakeResult } from "../src/components/IntakeSummaryBar";
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

describe("Detail: the AI mapping 'why' surface", () => {
  const result: IntakeResult = {
    mode: "remake-ai",
    name: "会社",
    ts: 0,
    usedAi: true,
    summary: {
      layoutCount: 2,
      status: "ok",
      findings: [],
      theme: { major: "Arial", minor: "游ゴシック", palette: ["#0a1a2f", "#2b6cb0"], logo: true },
    },
    mappings: [
      { base: "Title.1Title.Single", rename: "00_表紙", reason: "cover: single centred title" },
      { base: "Column.2Body.Equal", rename: "比較", reason: "bodies=2" },
    ],
  };

  it("renders each source→base mapping with its reason, plus the extracted theme swatches", () => {
    const html = renderToStaticMarkup(<Detail result={result} />);
    // per-layout mapping (raw data, i18n-independent)
    expect(html).toContain("00_表紙");
    expect(html).toContain("Title.1Title.Single");
    expect(html).toContain("cover: single centred title");
    expect(html).toContain("比較");
    expect(html).toContain("Column.2Body.Equal");
    // theme swatches rendered as background colors
    expect(html).toContain("#0a1a2f");
    expect(html).toContain("Arial");
  });

  it("omits the mapping table for a non-AI (deterministic) intake", () => {
    const det: IntakeResult = { ...result, mode: "remake", usedAi: undefined, mappings: undefined };
    const html = renderToStaticMarkup(<Detail result={det} />);
    expect(html).not.toContain("00_表紙");
    expect(html).toContain("Arial"); // theme still shown
  });

  it("renders mini WYSIWYG layout previews (SlideCards) when a template is provided", async () => {
    const tpl = await loadTemplate(new Uint8Array(readFileSync(CANON)));
    const sample = parseMd("# T\n\n- a\n- b");
    const name0 = tpl.layouts[0].name;
    const res: IntakeResult = {
      mode: "remake-ai", name: "x", ts: 0, usedAi: true,
      summary: { layoutCount: tpl.layouts.length, status: "ok", findings: [], theme: { major: "Arial", minor: "Arial", palette: ["#111"], logo: false } },
      mappings: [{ base: name0, rename: name0, reason: "cover" }],
    };
    const html = renderToStaticMarkup(<Detail result={res} template={tpl} sample={sample} />);
    // the thumbnail path ran (preview heading present), NOT the text mapping-table fallback
    expect(html).toContain("プレビュー"); // intake.previewTitle
    expect(html).toContain(name0); // the layout's name label under its thumbnail
    expect(html).toContain("cover"); // the AI mapping caption (→ base · reason)
    expect(html).toContain("208px"); // a LayoutThumb (THUMB_W) with a SlideCard inside actually rendered
  });
});
