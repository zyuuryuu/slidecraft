/**
 * canonical-group-detect.test.ts — #136: create_template()'s canonical 30-layout output must survive
 * its own geometric group detection (group-layout.ts). Before the fix, Process.3Step/4Step.Sequential
 * detected as null (no chrome/heading substructure geometry) and KPI.4Value.Grid mis-detected as
 * compare/2 (2x2 grid read as 2 columns of 2), so `<!-- step -->` / a 4-value KPI grid never landed on
 * their intended layout via autoSelectLayout (GROUP_MATCH requires groupKind+groupCount on the catalog
 * entry). Fix: group-layout.ts trusts a canonical dotted name (Family.NDetail.*) as a group-shape hint,
 * ONLY for SlideCraft's own family/count naming convention — never touches third-party masters (those
 * have no such name, so the hint never matches; see group-detect.test.ts for the untouched corpus).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";
import { detectGroups, expandGroups } from "../src/engine/group-binding";
import type { SlideIR } from "../src/engine/slide-schema";

const find = (cat: LayoutCatalog, name: string) => cat.find((e) => e.name === name)!;
const findLayout = (t: TemplateData, name: string) => t.layouts.find((l) => l.name === name)!;

describe("#136 canonical create_template() output survives group detection", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;

  beforeAll(async () => {
    const bytes = await writeTemplate({ name: "X", fonts: { major: "Georgia", minor: "Calibri" }, palette: { ...MIDNIGHT_PALETTE } });
    tpl = await loadTemplate(Buffer.from(bytes));
    catalog = buildCatalog(tpl);
  });

  it("Process.3Step.Sequential → step, 3 groups (was: undetected)", () => {
    const e = find(catalog, "Process.3Step.Sequential");
    expect(e.groupKind).toBe("step");
    expect(e.groupCount).toBe(3);
  });

  it("Process.4Step.Sequential → step, 4 groups (was: undetected)", () => {
    const e = find(catalog, "Process.4Step.Sequential");
    expect(e.groupKind).toBe("step");
    expect(e.groupCount).toBe(4);
  });

  it("KPI.4Value.Grid → kpi, 4 groups (was: mis-detected as compare/2)", () => {
    const e = find(catalog, "KPI.4Value.Grid");
    expect(e.groupKind).toBe("kpi");
    expect(e.groupCount).toBe(4);
  });

  it("at least one card-family layout is detected as card/N (was: zero among the 30)", () => {
    const cards = catalog.filter((e) => e.groupKind === "card");
    expect(cards.length).toBeGreaterThanOrEqual(1);
  });

  it("Summary.2Block.Equal → card, 2 groups (the layout the issue names as card-family)", () => {
    const e = find(catalog, "Summary.2Block.Equal");
    expect(e.groupKind).toBe("card");
    expect(e.groupCount).toBe(2);
  });

  it("regression: KPI.3Value.Equal stays kpi/3 (already correct — must not change)", () => {
    const e = find(catalog, "KPI.3Value.Equal");
    expect(e.groupKind).toBe("kpi");
    expect(e.groupCount).toBe(3);
  });

  it("regression: Compare.2Option.Versus stays compare/2 (genuinely a compare layout)", () => {
    const e = find(catalog, "Compare.2Option.Versus");
    expect(e.groupKind).toBe("compare");
    expect(e.groupCount).toBe(2);
  });

  it("single-slot group (Process.3Step) keeps BOTH heading and body text — no silent content drop", () => {
    const layout = findLayout(tpl, "Process.3Step.Sequential");
    const shape = detectGroups(layout)!;
    expect(shape.groups.every((g) => g.length === 1)).toBe(true); // one placeholder per step
    const slide: SlideIR = {
      layout: layout.name,
      groupKind: "step",
      placeholders: [
        { idx: "1", paragraphs: [{ heading: true, segments: [{ text: "要件定義" }] }, { segments: [{ text: "基準を確定する" }] }] },
      ],
    };
    const out = expandGroups(slide, layout);
    const only = shape.groups[0][0].phIdx;
    const paras = out.get(only)!.paragraphs;
    const allText = paras.flatMap((p) => p.segments.map((s) => s.text)).join("|");
    expect(allText).toContain("要件定義");
    expect(allText).toContain("基準を確定する");
  });
});
