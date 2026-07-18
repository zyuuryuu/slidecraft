/**
 * binding-plan.test.ts — ADR-0030 stage A: `resolveBinding` is a PURE OBSERVATION wrapper over the
 * existing binding primitives (bindContentByRole + unboundContent). It must NOT change routing — its
 * `assignments` reconstruct bindContentByRole byte-for-byte — and it must account for EVERY slide
 * content exactly once across `assignments ∪ unbound` (the no-silent-drop bijection). `slideBindingPlan`
 * mirrors the export/preview dispatch (grouped → expandGroups, else → resolveBinding) into one envelope.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { distillDeck } from "../src/engine/distill";
import { writeTemplate } from "../src/engine/template-writer";
import { parseTemplateSpecResponse } from "../src/engine/template-spec-prompts";
import { bindContentByRole, resolveBinding } from "../src/engine/placeholder-binding";
import { slideBindingPlan, expandGroups, isGroupedLayout } from "../src/engine/group-binding";
import type { SlideIR } from "../src/engine/slide-schema";

const ALIEN = resolve(__dirname, "fixtures/templates/lrk-slides-velis_CC0.pptx");
const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");

const KPI_MD = `# 主要指標

<!-- kpi -->
### 売上
- 14.8億

<!-- kpi -->
### 利益
- 3.6億

<!-- kpi -->
### 粗利率
- 31.5%

<!-- kpi -->
### 解約率
- 5.2%`;

const CARD_MD = `# カード

<!-- card -->
### A
- あ

<!-- card -->
### B
- い

<!-- card -->
### C
- う`;

async function defaultTemplate(): Promise<TemplateData> {
  const spec = parseTemplateSpecResponse("{}");
  if (!spec.ok) throw new Error("default spec parse failed");
  return loadTemplate(await writeTemplate(spec.spec));
}

const canonicalSlide: SlideIR = {
  layout: "auto",
  placeholders: [
    { idx: "15", paragraphs: [{ segments: [{ text: "TITLE_X" }] }] },
    { idx: "1", paragraphs: [{ segments: [{ text: "BODY_X" }], bullet: true }] },
  ],
};

describe("resolveBinding — pure observation over the binding primitives", () => {
  let alien: TemplateData;
  beforeAll(async () => { alien = await loadTemplate(readFileSync(ALIEN)); });

  it("assignments are byte-identical to bindContentByRole (no new routing)", () => {
    const catalog = buildCatalog(alien);
    const layout = findLayout(alien, autoSelectLayout(canonicalSlide, 1, 3, catalog))!;
    const bound = bindContentByRole(canonicalSlide, layout.placeholders);
    const plan = resolveBinding(canonicalSlide, layout.placeholders);

    // Same placeholder idxs, and each maps to the SAME content object (identity) as bindContentByRole.
    const reconstructed = new Map(plan.assignments.map((a) => [a.placeholder.idx, a.content.content]));
    expect(new Set(reconstructed.keys())).toEqual(new Set(bound.keys()));
    for (const [idx, content] of bound) expect(reconstructed.get(idx)).toBe(content);
  });

  it("BIJECTION: every non-blank content appears exactly once across assignments ∪ unbound", () => {
    const catalog = buildCatalog(alien);
    // A slide with MORE bodies than a 1-body content layout offers → at least one unbound.
    const slide: SlideIR = {
      layout: "auto",
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
        { idx: "1", paragraphs: [{ segments: [{ text: "B1" }], bullet: true }] },
        { idx: "2", paragraphs: [{ segments: [{ text: "B2" }], bullet: true }] },
        { idx: "3", paragraphs: [{ segments: [{ text: "B3" }], bullet: true }] },
        { idx: "4", paragraphs: [{ segments: [{ text: "B4" }], bullet: true }] },
      ],
    };
    const layout = findLayout(alien, autoSelectLayout(slide, 1, 3, catalog))!;
    const plan = resolveBinding(slide, layout.placeholders);

    const assigned = plan.assignments.map((a) => a.content.content);
    const unbound = plan.unbound.map((u) => u.content);
    const union = [...assigned, ...unbound];

    // disjoint (no content both assigned and unbound)
    expect(new Set(union).size).toBe(union.length);
    // every non-blank content is covered exactly once
    const nonBlank = slide.placeholders.filter((c) => c.paragraphs.some((p) => p.segments.some((s) => s.text.trim() !== "")));
    for (const c of nonBlank) expect(union.filter((x) => x === c).length).toBe(1);
    expect(new Set(union)).toEqual(new Set(nonBlank));
  });

  it("surfaces overflow as unbound: 4 bodies onto a 3-body layout drops the 4th", async () => {
    const tpl = await defaultTemplate();
    const catalog = buildCatalog(tpl);
    const deck = distillDeck(parseMd(KPI_MD), catalog);
    const slide = deck.slides[0];
    const layout = findLayout(tpl, autoSelectLayout(slide, 0, deck.slides.length, catalog))!;
    // #135: a 4-group kpi slide falls through to a 3-body columns layout (not a group layout).
    expect(isGroupedLayout(layout)).toBe(false);
    const plan = resolveBinding(slide, layout.placeholders);
    expect(plan.unbound.length).toBeGreaterThan(0);
    expect(plan.unbound.some((u) => u.content.paragraphs.flatMap((p) => p.segments.map((s) => s.text)).join("").includes("5.2%"))).toBe(true);
  });
});

describe("slideBindingPlan — mirrors the export/preview dispatch", () => {
  let report: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => { report = await loadTemplate(readFileSync(REPORT)); catalog = buildCatalog(report); });

  it("a grouped slide's assignments mirror expandGroups verbatim", () => {
    const deck = distillDeck(parseMd(CARD_MD), catalog);
    const slide = deck.slides[0];
    const layout = findLayout(report, autoSelectLayout(slide, 0, deck.slides.length, catalog))!;
    expect(slide.groupKind).toBeTruthy();
    expect(isGroupedLayout(layout)).toBe(true); // a real group layout is selected (3 cards fit)

    const bound = expandGroups(slide, layout);
    const plan = slideBindingPlan(slide, layout);
    const reconstructed = new Map(plan.assignments.map((a) => [a.placeholder.idx, a.content.content]));
    expect(new Set(reconstructed.keys())).toEqual(new Set(bound.keys()));
    // expandGroups makes fresh copies for group cells, so compare by VALUE (two calls → two copies) — the
    // point is that slideBindingPlan mirrors expandGroups' output faithfully, not that it shares objects.
    for (const [idx, content] of bound) expect(reconstructed.get(idx)).toEqual(content);
    // 3 cards fit a 3-column layout → nothing dropped.
    expect(plan.unbound.length).toBe(0);
  });

  it("delegates a non-group slide to resolveBinding (identical plan)", () => {
    const deck = distillDeck(parseMd("# 概要\n\n- 速い\n- 安い"), catalog);
    const slide = deck.slides[0];
    const layout = findLayout(report, autoSelectLayout(slide, 0, deck.slides.length, catalog))!;
    const viaPlan = slideBindingPlan(slide, layout);
    const viaResolve = resolveBinding(slide, layout.placeholders);
    expect(viaPlan.assignments.map((a) => a.placeholder.idx).sort()).toEqual(viaResolve.assignments.map((a) => a.placeholder.idx).sort());
    expect(viaPlan.unbound.length).toBe(viaResolve.unbound.length);
  });
});
