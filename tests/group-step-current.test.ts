/**
 * group-step-current.test.ts — #401: `<!-- step * -->` marks the CURRENT step of a process band
 * ("全体像＋現在位置" on one slide). Same semantics as the section-nav "current chapter bold" precedent
 * (deck-sections.ts sectionNavParagraphs, #167): the current cell's heading runs are bold.
 *
 * IR: SlideIR.currentSteps (optional, 1-based group ordinals) beside groupKind. Absent ⇔ no `*`, so a
 * step deck without the marker is byte-identical. Only `step` accepts `*` (card/kpi untouched).
 *
 * Bold alone is invisible on templates whose step heading style is ALREADY bold (every report-family
 * `11_プロセス` layout — measured), so the current column also gets a thin frame (the Issue's
 * "可能ならセル枠の強調") drawn through the shared overlay painter (preview == export).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData, type LayoutInfo } from "../src/engine/template-loader";
import { expandGroups, groupCellOverlay, detectGroups } from "../src/engine/group-binding";
import { isEmptyOverlay } from "../src/engine/group-overlay";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { generatePptx } from "../src/engine/placeholder-filler";
import type { SlideIR } from "../src/engine/slide-schema";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard } from "../src/components/SlidePreview";

const DIR = resolve(__dirname, "fixtures/templates");
const STEPS = (marks: string[]) =>
  `# 進捗\n\n` + ["要件", "設計", "実装", "試験"].map((h, i) => `<!-- step${marks[i] ?? ""} -->\n### ${h}\n${h}の説明\n`).join("\n");
const slideOf = (md: string): SlideIR => parseMd(md).slides[0];

describe("#401 parser: `<!-- step * -->` → currentSteps", () => {
  it("4 steps, the 2nd starred → currentSteps [2]; cell content identical to the unstarred deck", () => {
    const starred = slideOf(STEPS(["", " *"]));
    const plain = slideOf(STEPS([]));
    expect(starred.groupKind).toBe("step");
    expect(starred.currentSteps).toEqual([2]);
    expect(starred.placeholders).toEqual(plain.placeholders);
  });

  it("no star → the field is ABSENT (IR byte-identical)", () => {
    expect("currentSteps" in slideOf(STEPS([]))).toBe(false);
  });

  it("a starred FIRST separator still detects the step group; spacing variants accepted", () => {
    expect(slideOf(STEPS(["*"])).currentSteps).toEqual([1]);
    expect(slideOf(STEPS(["", "", "   *  "])).currentSteps).toEqual([3]);
  });

  it("multiple stars are all kept (no-silent-drop), ascending", () => {
    expect(slideOf(STEPS([" *", "", " *"])).currentSteps).toEqual([1, 3]);
  });

  it("card/kpi never get currentSteps (no ripple)", () => {
    expect("currentSteps" in slideOf("# T\n\n<!-- card -->\n### A\nx\n\n<!-- card -->\n### B\ny")).toBe(false);
    expect("currentSteps" in slideOf("# T\n\n<!-- kpi -->\n### A\n1\n\n<!-- kpi -->\n### B\n2")).toBe(false);
  });
});

describe("#401 round-trip", () => {
  it("`*` is written back on the same step; markdown byte-stable; IR equal", () => {
    const md = STEPS(["", " *"]);
    const once = serializeMd(parseMd(md));
    expect(once.split("\n").filter((l) => l.startsWith("<!-- step"))).toEqual([
      "<!-- step -->",
      "<!-- step * -->",
      "<!-- step -->",
      "<!-- step -->",
    ]);
    expect(serializeMd(parseMd(once))).toBe(once);
    const back = parseMd(once).slides[0];
    expect(back.currentSteps).toEqual([2]);
    expect(back.placeholders).toEqual(slideOf(md).placeholders);
  });

  it("a starred EMPTY trailing step survives the round-trip", () => {
    const md = "# T\n\n<!-- step -->\n### A\na\n\n<!-- step * -->\n";
    const s = slideOf(md);
    expect(s.currentSteps).toEqual([2]);
    expect(parseMd(serializeMd({ slides: [s] })).slides[0].currentSteps).toEqual([2]);
  });

  it("an unstarred step deck serializes exactly as before (no `*` anywhere)", () => {
    expect(serializeMd(parseMd(STEPS([])))).not.toContain("*");
  });
});

describe("#401 render: current step heading bold + frame", () => {
  let tpl: TemplateData;
  let proc: LayoutInfo;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(resolve(DIR, "報告書テンプレート_全レイアウト見本.pptx")));
    proc = tpl.layouts.find((l) => l.name === "11_プロセス")!;
  });

  it("expandGroups: ONLY the 2nd column's heading segments become bold; everything else identical", () => {
    const shape = detectGroups(proc)!;
    const plain = expandGroups(slideOf(STEPS([])), proc);
    const cur = expandGroups(slideOf(STEPS(["", " *"])), proc);
    const head2 = shape.groups[1].find((s) => s.role === "heading")!.phIdx;
    expect(cur.get(head2)!.paragraphs[0].segments).toEqual([{ text: "設計", bold: true }]);
    for (const [k, v] of plain) if (k !== head2) expect(cur.get(k)).toEqual(v);
    expect([...cur.keys()].sort()).toEqual([...plain.keys()].sort());
  });

  it("overlay: one frame enclosing the 2nd column, clear of its neighbours; no icons/insets", () => {
    const shape = detectGroups(proc)!;
    const ov = groupCellOverlay(slideOf(STEPS(["", " *"])), proc);
    expect(ov.icons).toEqual([]);
    expect(ov.insets.size).toBe(0);
    expect(ov.frames).toHaveLength(1);
    const f = ov.frames[0];
    const boxOf = (col: number) => {
      const phs = shape.groups[col].map((s) => proc.placeholders.find((p) => p.idx === s.phIdx)!.style);
      return {
        x0: Math.min(...phs.map((s) => s.x)), x1: Math.max(...phs.map((s) => s.x + s.w)),
        y0: Math.min(...phs.map((s) => s.y)), y1: Math.max(...phs.map((s) => s.y + s.h)),
      };
    };
    const c = boxOf(1);
    expect(f.x).toBeLessThan(c.x0);
    expect(f.y).toBeLessThan(c.y0);
    expect(f.x + f.w).toBeGreaterThan(c.x1);
    expect(f.y + f.h).toBeGreaterThan(c.y1);
    expect(f.x).toBeGreaterThan(boxOf(0).x1); // does not reach into column 1
    expect(f.x + f.w).toBeLessThan(boxOf(2).x0); // nor column 3
    const headIdx = shape.groups[1].find((s) => s.role === "heading")!.phIdx;
    expect(f.color).toBe(proc.placeholders.find((p) => p.idx === headIdx)!.style.fontColor);
  });

  it("no star → empty overlay; currentSteps on a CARD slide is ignored (no bold, no frame)", () => {
    expect(isEmptyOverlay(groupCellOverlay(slideOf(STEPS([])), proc))).toBe(true);
    const card = tpl.layouts.find((l) => l.name === "10_カード3列")!;
    const cardSlide: SlideIR = { ...slideOf("# T\n\n<!-- card -->\n### A\nx\n\n<!-- card -->\n### B\ny"), currentSteps: [1] };
    expect(isEmptyOverlay(groupCellOverlay(cardSlide, card))).toBe(true);
    const { currentSteps: _drop, ...noMark } = cardSlide;
    void _drop;
    expect(expandGroups(cardSlide, card)).toEqual(expandGroups(noMark, card));
  });

  it("single-slot step layout (Midnight Process.4Step): the merged slot's heading run is bold, body is not", async () => {
    const mid = await loadTemplate(readFileSync(resolve(DIR, "Midnight_Executive_30_TemplateOnly.pptx")));
    const p4 = mid.layouts.find((l) => l.name === "Process.4Step.Sequential")!;
    const shape = detectGroups(p4)!;
    const slot = shape.groups[1].find((s) => s.role === "heading")!.phIdx;
    const paras = expandGroups(slideOf(STEPS(["", " *"])), p4).get(slot)!.paragraphs;
    expect(paras[0].segments).toEqual([{ text: "設計", bold: true }]);
    expect(paras[1].segments.some((s) => s.bold)).toBe(false);
  });
});

describe("#401 export (PPTX)", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(resolve(DIR, "報告書テンプレート_全レイアウト見本.pptx"))); });
  const slide2 = async (md: string) => {
    const deck = parseMd(`# 表紙\n\n---\n\n${md}`);
    deck.template = undefined;
    const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
    return zip.file("ppt/slides/slide2.xml")!.async("string");
  };
  /** The whole <a:r>…</a:r> whose text is `text` (never spans another run's end). */
  const runOf = (xml: string, text: string) => xml.match(new RegExp(`<a:r>(?:(?!</a:r>).)*?<a:t>${text}</a:t></a:r>`))?.[0] ?? null;

  it("2nd of 4 starred → only the 2nd heading run has b=\"1\"; a frame shape is added", async () => {
    const xml = await slide2(STEPS(["", " *"]));
    const plain = await slide2(STEPS([]));
    expect(runOf(xml, "設計")).toContain('b="1"');
    for (const h of ["要件", "実装", "試験"]) {
      expect(runOf(xml, h)).not.toBeNull();
      expect(runOf(xml, h)).not.toContain('b="1"');
    }
    for (const h of ["要件", "設計", "実装", "試験"]) {
      expect(runOf(plain, h)).not.toBeNull();
      expect(runOf(plain, h)).not.toContain('b="1"');
    }
    const count = (x: string) => (x.match(/<p:sp>/g) || []).length;
    expect(count(xml)).toBe(count(plain) + 1);
    const ids = [...xml.matchAll(/<p:cNvPr[^>]*\bid="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("#401 preview (SlideCard)", () => {
  it("the current step's heading renders bold and ONE overlay SVG is added; unstarred → none", async () => {
    const tpl = await loadTemplate(readFileSync(resolve(DIR, "報告書テンプレート_全レイアウト見本.pptx")));
    const proc = tpl.layouts.find((l) => l.name === "11_プロセス")!;
    const render = (md: string) =>
      renderToStaticMarkup(createElement(SlideCard, { slide: slideOf(md), slideIndex: 0, layout: proc, scale: 60, isActive: false, selected: false, onClick: () => {} }));
    const svgCount = (h: string) => (h.match(/<svg/g) || []).length; // the layout's own arrows are SVG too
    const cur = render(STEPS(["", " *"]));
    const plain = render(STEPS([]));
    expect(cur).toMatch(/font-weight:bold[^>]*>設計</);
    expect(svgCount(cur)).toBe(svgCount(plain) + 1);
    expect(plain).not.toMatch(/font-weight:bold[^>]*>設計</);
  });
});
