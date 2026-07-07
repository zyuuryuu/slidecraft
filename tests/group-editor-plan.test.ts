/**
 * group-editor-plan.test.ts — S6. For a grouped slide the editor shows ONE field per GROUP (the group's
 * "### 見出し\n本文" markdown, keyed by content idx 1..N) instead of buildFieldMap over the layout's many
 * per-group cells. groupEditorPlan returns the meta placeholders (title/date/… — still buildFieldMap'd)
 * and the column count; null for a non-grouped slide (editor keeps buildFieldMap, 1:1 untouched).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData, type LayoutInfo } from "../src/engine/template-loader";
import { detectGroups, groupEditorPlan } from "../src/engine/group-binding";
import type { SlideIR } from "../src/engine/slide-schema";

const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");
const cardSlide = (layout: string): SlideIR => ({
  layout, groupKind: "card",
  placeholders: [
    { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
    { idx: "1", paragraphs: [{ heading: true, segments: [{ text: "収集層" }] }, { segments: [{ text: "eBPF" }] }] },
    { idx: "2", paragraphs: [{ heading: true, segments: [{ text: "分析層" }] }, { segments: [{ text: "SIEM" }] }] },
  ],
});

describe("groupEditorPlan (S6)", () => {
  let tpl: TemplateData;
  let layout: LayoutInfo;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(REPORT)); layout = tpl.layouts.find((l) => /^10_カード/.test(l.name))!; });

  it("metaPhs EXCLUDES the group cells; columns = 3", () => {
    const plan = groupEditorPlan(cardSlide(layout.name), layout)!;
    expect(plan).toBeTruthy();
    expect(plan.columns).toBe(3);
    const groupPhIdxs = new Set(detectGroups(layout)!.groups.flat().map((s) => s.phIdx));
    for (const p of plan.metaPhs) expect(groupPhIdxs.has(p.idx), `meta ph ${p.idx} is a group cell`).toBe(false);
    expect(plan.metaPhs.some((p) => p.type.toLowerCase().includes("title"))).toBe(true); // title still editable
  });

  it("returns null for a NON-grouped slide (editor keeps buildFieldMap)", () => {
    const s: SlideIR = { ...cardSlide(layout.name), groupKind: undefined };
    expect(groupEditorPlan(s, layout)).toBeNull();
  });

  it("returns null when the layout is not a group layout", async () => {
    const content = tpl.layouts.find((l) => /02_本文（1カラム）/.test(l.name))!;
    expect(groupEditorPlan(cardSlide(content.name), content)).toBeNull();
  });
});
