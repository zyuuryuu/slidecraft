/**
 * compare-group.test.ts — #396: `<!-- compare -->` makes the vs-comparison layout reachable from auto.
 *
 * The templates already ship a 2-option compare layout (canonical `Compare.2Option.Versus`, the report
 * family's `12_課題と対策`), and buildCatalog already tags it groupKind "compare" — but no markdown marker
 * produced that kind, so auto selection never landed there (pin-only). The marker joins card/step/kpi:
 * parser → groupKind "compare" → GROUP_MATCH → the compare layout, cells bound to separate bodies.
 *
 * Also locks the root cause found on the way: the canonical `SectionNav.1Title.Single` (a chapter
 * divider) read as a 2-group compare layout by geometry, and sat BEFORE Compare.2Option.Versus in the
 * catalog — so the marker would have routed to the divider. Canonical names now decide it by name.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";
import { detectGroups, expandGroups } from "../src/engine/group-binding";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import type { DeckIR } from "../src/engine/slide-schema";

const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");

const COMPARE_MD = `# A 案と B 案

<!-- compare -->
### A 案：内製
- 初期費用が低い
- 立ち上げに半年

<!-- compare -->
### B 案：外注
- 初期費用が高い
- 1 か月で稼働`;

const text = (paras: { segments: { text: string }[] }[] | undefined) =>
  (paras ?? []).map((p) => p.segments.map((s) => s.text).join("")).join("|");

describe("#396 parse — `<!-- compare -->` is a group separator", () => {
  it("2 cells → groupKind compare, cell headings + bodies at content idx 1/2", () => {
    const s = parseMd(COMPARE_MD).slides[0];
    expect(s.groupKind).toBe("compare");
    expect(s.layout).toBe("auto");
    const c1 = s.placeholders.find((p) => p.idx === "1")!;
    const c2 = s.placeholders.find((p) => p.idx === "2")!;
    expect(c1.paragraphs[0]).toMatchObject({ heading: true, segments: [{ text: "A 案：内製" }] });
    expect(c2.paragraphs[0]).toMatchObject({ heading: true, segments: [{ text: "B 案：外注" }] });
    expect(text(c1.paragraphs)).toContain("初期費用が低い");
    expect(text(c2.paragraphs)).toContain("1 か月で稼働");
  });

  it("the marker is a directive, not a dropped comment (a stray one inside a cell is not swallowed as #147 noise)", () => {
    const s = parseMd("# T\n\n<!-- compare -->\nA\n\n<!-- compare -->\nB").slides[0];
    expect(s.placeholders.filter((p) => /^[1-9]$/.test(p.idx))).toHaveLength(2);
  });
});

describe("#396 auto selection — canonical template (create_template output)", () => {
  let tpl: TemplateData;
  let cat: LayoutCatalog;
  beforeAll(async () => {
    const bytes = await writeTemplate({ name: "X", fonts: { major: "Georgia", minor: "Calibri" }, palette: { ...MIDNIGHT_PALETTE } });
    tpl = await loadTemplate(Buffer.from(bytes));
    cat = buildCatalog(tpl);
  });

  it("root cause: SectionNav.1Title.Single (a chapter divider) is NOT a group layout", () => {
    expect(detectGroups(findLayout(tpl, "SectionNav.1Title.Single")!)).toBeNull();
    expect(cat.find((e) => e.name === "SectionNav.1Title.Single")!.groupKind).toBeUndefined();
  });

  it("the only compare entry is Compare.2Option.Versus (2 groups: [label, content] × 2)", () => {
    expect(cat.filter((e) => e.groupKind === "compare").map((e) => e.name)).toEqual(["Compare.2Option.Versus"]);
    const shape = detectGroups(findLayout(tpl, "Compare.2Option.Versus")!)!;
    expect(shape.groups.map((g) => g.map((s) => `${s.phIdx}:${s.role}`))).toEqual([["1:heading", "2:body"], ["3:heading", "4:body"]]);
  });

  it("2-cell compare slide → Compare.2Option.Versus, each cell bound to its own label + body", () => {
    const s = parseMd(COMPARE_MD).slides[0];
    const name = autoSelectLayout(s, 1, 3, cat);
    expect(name).toBe("Compare.2Option.Versus");
    const out = expandGroups(s, findLayout(tpl, name)!);
    expect(text(out.get("1")?.paragraphs)).toBe("A 案：内製");
    expect(text(out.get("2")?.paragraphs)).toContain("初期費用が低い");
    expect(text(out.get("3")?.paragraphs)).toBe("B 案：外注");
    expect(text(out.get("4")?.paragraphs)).toContain("1 か月で稼働");
    expect(text(out.get("2")?.paragraphs)).not.toContain("1 か月で稼働"); // cells never merge
  });

  it("3 cells overshoot every compare layout → falls through to the ordinary columns pick (not compare)", () => {
    const s = parseMd("# T\n\n<!-- compare -->\nA\n\n<!-- compare -->\nB\n\n<!-- compare -->\nC").slides[0];
    const name = autoSelectLayout(s, 1, 3, cat);
    expect(cat.find((e) => e.name === name)!.groupKind).not.toBe("compare");
    expect(name).toBe(autoSelectLayout({ ...s, groupKind: undefined }, 1, 3, cat)); // == plain 3 columns
  });

  it("existing routing unchanged: card/step/kpi still pick their own families", () => {
    const g = (k: string) => parseMd(`# T\n\n<!-- ${k} -->\n### a\n- x\n\n<!-- ${k} -->\n### b\n- y`).slides[0];
    expect(autoSelectLayout(g("card"), 1, 3, cat)).toBe("Summary.2Block.Equal");
    expect(autoSelectLayout(g("kpi"), 1, 3, cat)).toBe("KPI.2Value.Equal");
    expect(cat.find((e) => e.name === autoSelectLayout(g("step"), 1, 3, cat))!.groupKind).toBe("step");
  });
});

describe("#396 auto selection — third-party report template", () => {
  it("compare → 12_課題と対策 (the report family's 2-option compare layout)", async () => {
    const tpl = await loadTemplate(readFileSync(REPORT));
    const cat = buildCatalog(tpl);
    const s = parseMd(COMPARE_MD).slides[0];
    const name = autoSelectLayout(s, 1, 3, cat);
    expect(name).toBe("12_課題と対策");
    const out = expandGroups(s, findLayout(tpl, name)!);
    expect(text(out.get("13")?.paragraphs)).toBe("A 案：内製");
    expect(text(out.get("15")?.paragraphs)).toBe("B 案：外注");
  });
});

describe("#396 round-trip — the marker survives serialize → parse", () => {
  const strip = (d: DeckIR) => d.slides.map((s) => ({ ...s, sourceLineStart: undefined, sourceLineEnd: undefined }));

  it("template-less and with the canonical template: md is stable and the IR is identical", async () => {
    const bytes = await writeTemplate({ name: "X", fonts: { major: "Georgia", minor: "Calibri" }, palette: { ...MIDNIGHT_PALETTE } });
    const tpl = await loadTemplate(Buffer.from(bytes));
    const deck = parseMd(COMPARE_MD);
    for (const t of [undefined, { catalog: buildCatalog(tpl), layouts: tpl.layouts }]) {
      const once = serializeMd(deck, t);
      expect(once.match(/<!-- compare -->/g)).toHaveLength(2);
      expect(once).not.toMatch(/<!-- (col|card|kpi|step) -->/);
      const re = parseMd(once);
      expect(strip(re)).toEqual(strip(deck));
      expect(serializeMd(re, t)).toBe(once);
    }
  });
});
