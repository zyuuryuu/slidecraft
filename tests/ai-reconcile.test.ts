/**
 * ai-reconcile.test.ts — slice 1 of the AI-quality theme (docs: design decisions A2/B1/C3/D1).
 *
 * reconcileEdit(old, edited) is the deterministic "harness over model" guard: after an AI slide edit
 * is parsed to a SlideIR, it restores the STRUCTURAL scaffolding the model dropped (layout pin, title,
 * subtitle, meta, groupKind, diagram/mermaid/table/code) from the previous slide, while respecting
 * everything the edit explicitly kept (respect-if-present, D1). Body content is the edit's to change.
 * It must NEVER create a duplicate placeholder idx (ADR-0011 1:1 injectivity).
 */
import { describe, it, expect } from "vitest";
import { reconcileEdit } from "../src/engine/ai-reconcile";
import { validateStructure, mergeVerdicts, validateCondense } from "../src/engine/ai-validate";
import type { SlideIR } from "../src/engine/slide-schema";

const ph = (idx: string, text: string) => ({ idx, paragraphs: [{ segments: [{ text }] }] });
const bullets = (idx: string, ...txts: string[]) => ({
  idx,
  paragraphs: txts.map((t) => ({ segments: [{ text: t }], bullet: true })),
});
const slide = (s: Partial<SlideIR>): SlideIR => ({ layout: "auto", placeholders: [], ...s });

describe("reconcileEdit — layout pin", () => {
  it("restores a dropped layout pin (edited.layout='auto', old was concrete)", () => {
    const old = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "旧題"), bullets("1", "A")] });
    const edited = slide({ layout: "auto", placeholders: [bullets("1", "A2")] });
    expect(reconcileEdit(old, edited).layout).toBe("Content.1Body.Single");
  });

  it("respects an explicitly re-pinned layout (edited kept a header)", () => {
    const old = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "T")] });
    const edited = slide({ layout: "KPI.3Value.Equal", placeholders: [ph("15", "T")] });
    expect(reconcileEdit(old, edited).layout).toBe("KPI.3Value.Equal");
  });
});

describe("reconcileEdit — title / subtitle / meta (respect-if-present)", () => {
  it("restores a dropped content-layout title (idx15)", () => {
    const old = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "旧タイトル"), bullets("1", "A")] });
    const edited = slide({ layout: "Content.1Body.Single", placeholders: [bullets("1", "A2")] });
    const r = reconcileEdit(old, edited);
    expect(r.placeholders.find((p) => p.idx === "15")?.paragraphs[0].segments[0].text).toBe("旧タイトル");
    // the edit's body is respected
    expect(r.placeholders.find((p) => p.idx === "1")?.paragraphs[0].segments[0].text).toBe("A2");
  });

  it("respects a present (edited) title — does not overwrite with old", () => {
    const old = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "旧"), bullets("1", "A")] });
    const edited = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "新"), bullets("1", "A")] });
    expect(reconcileEdit(old, edited).placeholders.find((p) => p.idx === "15")?.paragraphs[0].segments[0].text).toBe("新");
  });

  it("restores a dropped title-layout title (idx0) and meta idx10/11/12 independently", () => {
    const old = slide({
      layout: "Title.1Title.Single",
      placeholders: [ph("0", "表紙"), ph("1", "サブ"), ph("10", "部門"), ph("11", "2026"), ph("12", "脚注")],
    });
    // edit kept + reworded the subtitle, dropped everything else (header included)
    const edited = slide({ layout: "auto", placeholders: [ph("1", "サブ改")] });
    const r = reconcileEdit(old, edited);
    expect(r.layout).toBe("Title.1Title.Single");
    expect(r.placeholders.find((p) => p.idx === "0")?.paragraphs[0].segments[0].text).toBe("表紙");
    expect(r.placeholders.find((p) => p.idx === "1")?.paragraphs[0].segments[0].text).toBe("サブ改");
    expect(r.placeholders.find((p) => p.idx === "10")?.paragraphs[0].segments[0].text).toBe("部門");
    expect(r.placeholders.find((p) => p.idx === "11")?.paragraphs[0].segments[0].text).toBe("2026");
    expect(r.placeholders.find((p) => p.idx === "12")?.paragraphs[0].segments[0].text).toBe("脚注");
  });
});

describe("reconcileEdit — figures (edited.X ?? old.X)", () => {
  const withFig = (extra: Partial<SlideIR>) =>
    slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "T")], ...extra });

  it("carries a dropped diagram / mermaid / table / code from old", () => {
    const old = withFig({
      diagram: { yaml: "type: flowchart", placeholderIdx: "1" },
    });
    const edited = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "T"), bullets("1", "x")] });
    expect(reconcileEdit(old, edited).diagram?.yaml).toBe("type: flowchart");

    const oldCode = withFig({ code: { content: "print(1)", placeholderIdx: "1" } });
    expect(reconcileEdit(oldCode, edited).code?.content).toBe("print(1)");

    const oldTable = withFig({ table: { rows: [["a", "b"]], placeholderIdx: "1" } });
    expect(reconcileEdit(oldTable, edited).table?.rows).toEqual([["a", "b"]]);

    const oldMer = withFig({ mermaidBlock: { mermaid: "graph TD", placeholderIdx: "1" } });
    expect(reconcileEdit(oldMer, edited).mermaidBlock?.mermaid).toBe("graph TD");
  });

  it("respects an edited figure (edited diagram wins over old)", () => {
    const old = withFig({ diagram: { yaml: "OLD", placeholderIdx: "1" } });
    const edited = withFig({ diagram: { yaml: "NEW", placeholderIdx: "1" } });
    expect(reconcileEdit(old, edited).diagram?.yaml).toBe("NEW");
  });
});

describe("reconcileEdit — groupKind (tied to the header signal)", () => {
  it("restores groupKind when the header was dropped (layout auto)", () => {
    const old = slide({ layout: "Content.1Body.Single", groupKind: "card", placeholders: [bullets("1", "見出しA")] });
    const edited = slide({ layout: "auto", placeholders: [bullets("1", "見出しA2")] });
    expect(reconcileEdit(old, edited).groupKind).toBe("card");
  });

  it("does NOT force groupKind when the edit re-pinned a concrete layout", () => {
    const old = slide({ layout: "Content.1Body.Single", groupKind: "card", placeholders: [bullets("1", "A")] });
    const edited = slide({ layout: "Content.1Body.Single", placeholders: [bullets("1", "A")] });
    expect(reconcileEdit(old, edited).groupKind).toBeUndefined();
  });
});

describe("reconcileEdit — safety invariants", () => {
  it("a fully-empty edit (meltdown) returns old wholesale (no-op)", () => {
    const old = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "T"), bullets("1", "A")] });
    const edited = slide({ layout: "auto", placeholders: [] });
    expect(reconcileEdit(old, edited)).toEqual(old);
  });

  it("never produces a duplicate placeholder idx (ADR-0011 injective)", () => {
    const old = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "旧"), ph("16", "サブ"), bullets("1", "A")] });
    const edited = slide({ layout: "auto", placeholders: [bullets("1", "A2")] });
    const idxs = reconcileEdit(old, edited).placeholders.map((p) => p.idx);
    expect(new Set(idxs).size).toBe(idxs.length);
  });

  it("regression (audit case): Content+Source edit dropping idx15/16 + diagram restores all", () => {
    const old = slide({
      layout: "Content.1Body.Single+1Source",
      placeholders: [ph("15", "見出し"), ph("16", "補足"), bullets("1", "要点")],
      diagram: { yaml: "type: flowchart", placeholderIdx: "2" },
    });
    const edited = slide({ layout: "auto", placeholders: [bullets("1", "要点2")] });
    const r = reconcileEdit(old, edited);
    expect(r.layout).toBe("Content.1Body.Single+1Source");
    expect(r.placeholders.find((p) => p.idx === "15")?.paragraphs[0].segments[0].text).toBe("見出し");
    expect(r.placeholders.find((p) => p.idx === "16")?.paragraphs[0].segments[0].text).toBe("補足");
    expect(r.diagram?.yaml).toBe("type: flowchart");
  });
});

describe("validateStructure — HARD/SOFT by kind", () => {
  const oldContent = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "見出し"), bullets("1", "A")] });

  it("layout pin loss is HARD for both kinds", () => {
    const after = slide({ layout: "auto", placeholders: [bullets("1", "A")] });
    expect(validateStructure(oldContent, after, "condense").hasHard).toBe(true);
    expect(validateStructure(oldContent, after, "edit").hasHard).toBe(true);
  });

  it("title loss is HARD for condense, SOFT for edit", () => {
    const after = slide({ layout: "Content.1Body.Single", placeholders: [bullets("1", "A")] }); // no idx15
    expect(validateStructure(oldContent, after, "condense").hasHard).toBe(true);
    const v = validateStructure(oldContent, after, "edit");
    expect(v.hasHard).toBe(false);
    expect(v.ok).toBe(false); // still reported as a SOFT violation
  });

  it("figure loss is HARD for condense but carried silently (no violation) for edit", () => {
    const old = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "T")], diagram: { yaml: "x", placeholderIdx: "1" } });
    const after = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "T"), bullets("1", "A")] });
    expect(validateStructure(old, after, "condense").hasHard).toBe(true);
    // a text-only edit omitting the figure is normal — reconcile carries it, so no violation is raised
    expect(validateStructure(old, after, "edit").ok).toBe(true);
  });

  it("no violation when structure is preserved", () => {
    const after = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "見出し"), bullets("1", "A2")] });
    expect(validateStructure(oldContent, after, "condense").ok).toBe(true);
  });

  it("mergeVerdicts combines two verdicts (ok AND, hasHard OR, violations concat)", () => {
    const structHard = validateStructure(oldContent, slide({ layout: "auto", placeholders: [bullets("1", "A")] }), "edit");
    const condClean = validateCondense("- A", "- A");
    const merged = mergeVerdicts(structHard, condClean);
    expect(merged.hasHard).toBe(true);
    expect(merged.ok).toBe(false);
    expect(merged.violations.length).toBe(structHard.violations.length + condClean.violations.length);
  });
});
