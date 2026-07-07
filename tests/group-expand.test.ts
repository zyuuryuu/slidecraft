/**
 * group-expand.test.ts — S2. expandGroups(slide, layout) fills a grouped layout from a Slice-A SlideIR
 * (groupKind + placeholders idx 1..N, each = [heading para] + body paras). It returns the SAME shape as
 * bindContentByRole (Map<layoutPhIdx, PlaceholderContent>) so preview/export consume it unchanged:
 *  - group k heading → col k heading slot; body → col k body slot(s) (KPI splits 数値/補足);
 *  - chrome number filled as editable slide content ("1","2"… / "STEP 1"…) for FILLED groups only;
 *  - empty groups (partial) and picture slots left inherited (no map entry);
 *  - title/subtitle/meta bound via bindContentByRole on a NON-GROUP subset (never touches idx13-24).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData, type LayoutInfo } from "../src/engine/template-loader";
import { detectGroups, expandGroups } from "../src/engine/group-binding";
import type { SlideIR } from "../src/engine/slide-schema";

const DIR = resolve(__dirname, "fixtures/templates");
const find = (t: TemplateData, re: RegExp) => t.layouts.find((l) => re.test(l.name))!;
const txt = (c: { paragraphs: { segments: { text: string }[] }[] } | undefined) =>
  (c?.paragraphs ?? []).flatMap((p) => p.segments.map((s) => s.text)).join("");
const grp = (idx: string, heading: string, ...body: string[]): SlideIR["placeholders"][number] => ({
  idx,
  paragraphs: [{ heading: true, segments: [{ text: heading }] }, ...body.map((b) => ({ segments: [{ text: b }] }))],
});

describe("expandGroups", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(resolve(DIR, "報告書テンプレート_全レイアウト見本.pptx"))); });

  it("card: heading→見出し枠, body→説明枠, chrome→'1'/'2', empty 3rd group inherited", () => {
    const layout: LayoutInfo = find(tpl, /^10_カード/);
    const shape = detectGroups(layout)!;
    const slide: SlideIR = { layout: layout.name, groupKind: "card", placeholders: [
      { idx: "15", paragraphs: [{ segments: [{ text: "タイトル" }] }] },
      grp("1", "収集層", "eBPF で可視化"),
      grp("2", "分析層", "SIEM へ集約"),
    ] };
    const out = expandGroups(slide, layout);
    const slot = (col: number, role: string) => shape.groups[col].find((s) => s.role === role)!.phIdx;

    expect(txt(out.get(slot(0, "heading")))).toBe("収集層");
    expect(out.get(slot(0, "heading"))!.paragraphs[0].heading).toBeFalsy(); // heading flag dropped
    expect(txt(out.get(slot(0, "body")))).toBe("eBPF で可視化");
    expect(txt(out.get(slot(0, "chrome")))).toBe("1"); // position number, editable slide content
    expect(txt(out.get(slot(1, "heading")))).toBe("分析層");
    expect(txt(out.get(slot(1, "chrome")))).toBe("2");
    // group 3 empty → inherited (no entries)
    expect(out.get(slot(2, "heading"))).toBeUndefined();
    expect(out.get(slot(2, "chrome"))).toBeUndefined();
    // title still bound (via non-group subset → bindContentByRole)
    const titlePh = layout.placeholders.find((p) => p.type.toLowerCase().includes("title"))!.idx;
    expect(txt(out.get(titlePh))).toBe("タイトル");
  });

  it("step: chrome keeps the 'STEP N' format with the position number", () => {
    const layout = find(tpl, /プロセス/);
    const shape = detectGroups(layout)!;
    const slide: SlideIR = { layout: layout.name, groupKind: "step", placeholders: [grp("1", "要件定義", "基準を確定"), grp("2", "環境構築", "PoC 環境")] };
    const out = expandGroups(slide, layout);
    expect(txt(out.get(shape.groups[0].find((s) => s.role === "chrome")!.phIdx))).toBe("STEP 1");
    expect(txt(out.get(shape.groups[1].find((s) => s.role === "chrome")!.phIdx))).toBe("STEP 2");
  });

  it("kpi: body para0→数値枠, para1→補足枠 (two body slots)", () => {
    const layout = find(tpl, /KPI/);
    const shape = detectGroups(layout)!;
    const slide: SlideIR = { layout: layout.name, groupKind: "kpi", placeholders: [
      { idx: "1", paragraphs: [{ heading: true, segments: [{ text: "売上" }] }, { segments: [{ text: "+40%" }] }, { segments: [{ text: "前年比" }] }] },
    ] };
    const out = expandGroups(slide, layout);
    const bodies = shape.groups[0].filter((s) => s.role === "body");
    expect(bodies.length).toBe(2);
    expect(txt(out.get(bodies[0].phIdx))).toBe("+40%"); // 数値
    expect(txt(out.get(bodies[1].phIdx))).toBe("前年比"); // 補足
    expect(txt(out.get(shape.groups[0].find((s) => s.role === "heading")!.phIdx))).toBe("売上");
  });

  it("overflow (more groups than columns): first N fill, extras are NOT in the map (dropped on export)", () => {
    const layout = find(tpl, /^10_カード/); // 3 columns
    const shape = detectGroups(layout)!;
    const slide: SlideIR = { layout: layout.name, groupKind: "card", placeholders: [
      grp("1", "A", "a"), grp("2", "B", "b"), grp("3", "C", "c"), grp("4", "D", "d"), grp("5", "E", "e"),
    ] };
    const out = expandGroups(slide, layout);
    expect(txt(out.get(shape.groups[2].find((s) => s.role === "heading")!.phIdx))).toBe("C"); // 3rd fills
    // no 4th/5th column exists → E/D simply absent from the map
    expect([...out.values()].some((v) => txt(v) === "D" || txt(v) === "E")).toBe(false);
  });

  it("returns an empty map when the slide has no groupKind (caller falls back to bindContentByRole)", () => {
    const layout = find(tpl, /^10_カード/);
    const slide: SlideIR = { layout: layout.name, placeholders: [{ idx: "1", paragraphs: [{ segments: [{ text: "x" }] }] }] };
    expect(expandGroups(slide, layout).size).toBe(0);
  });
});
