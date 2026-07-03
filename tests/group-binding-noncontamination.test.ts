/**
 * group-binding-noncontamination.test.ts — S3. The group path must NOT contaminate the canonical 1:1:
 *  - expandGroups routes title/subtitle/meta ONLY to their own placeholders and group content ONLY to
 *    group cells — no cross-leak (a group cell idx13-24 never receives the slide title, etc.);
 *  - it is gated on slide.groupKind (a non-grouped slide → empty map → caller uses bindContentByRole);
 *  - buildFieldMap on the grouped layouts stays a bijection (the group path never touches it).
 * The whole-suite `field-map-bijection.test.ts` (11 templates, full+sparse) remains the invariant guard.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData, type LayoutInfo } from "../src/engine/template-loader";
import { detectGroups, expandGroups } from "../src/engine/group-binding";
import { bindContentByRole, buildFieldMap } from "../src/engine/placeholder-binding";
import type { SlideIR } from "../src/engine/slide-schema";

const DIR = resolve(__dirname, "../public/templates/slide");
const find = (t: TemplateData, re: RegExp) => t.layouts.find((l) => re.test(l.name))!;
const txt = (c: { paragraphs: { segments: { text: string }[] }[] } | undefined) =>
  (c?.paragraphs ?? []).flatMap((p) => p.segments.map((s) => s.text)).join("");

describe("group path is non-contaminating", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(resolve(DIR, "報告書テンプレート_全レイアウト見本.pptx"))); });

  it("the slide TITLE goes to the title placeholder, never into a group cell (idx 13-24)", () => {
    const layout: LayoutInfo = find(tpl, /^10_カード/);
    const shape = detectGroups(layout)!;
    const groupPhIdxs = new Set(shape.groups.flat().map((s) => s.phIdx));
    const slide: SlideIR = { layout: layout.name, groupKind: "card", placeholders: [
      { idx: "15", paragraphs: [{ segments: [{ text: "SLIDE_TITLE" }] }] },
      { idx: "1", paragraphs: [{ heading: true, segments: [{ text: "H1" }] }, { segments: [{ text: "B1" }] }] },
    ] };
    const out = expandGroups(slide, layout);
    // title landed in the title ph (a NON-group ph)…
    const titlePh = layout.placeholders.find((p) => p.type.toLowerCase().includes("title"))!.idx;
    expect(groupPhIdxs.has(titlePh)).toBe(false);
    expect(txt(out.get(titlePh))).toBe("SLIDE_TITLE");
    // …and NO group cell contains the title text.
    for (const idx of groupPhIdxs) expect(txt(out.get(idx))).not.toBe("SLIDE_TITLE");
  });

  it("is gated: a slide WITHOUT groupKind yields an empty map (caller uses bindContentByRole)", () => {
    const layout = find(tpl, /^10_カード/);
    const slide: SlideIR = { layout: layout.name, placeholders: [
      { idx: "15", paragraphs: [{ segments: [{ text: "T" }] }] },
      { idx: "1", paragraphs: [{ segments: [{ text: "x" }] }] },
    ] };
    expect(expandGroups(slide, layout).size).toBe(0);
  });

  it("buildFieldMap on every grouped layout stays an injective, round-tripping bijection", () => {
    for (const re of [/^10_カード/, /プロセス/, /KPI/, /課題/]) {
      const layout = find(tpl, re);
      const map = buildFieldMap({ layout: layout.name, placeholders: [] }, layout.placeholders);
      const cidxs = map.map((m) => m.contentIdx);
      expect(new Set(cidxs).size, `${layout.name} field map not injective`).toBe(cidxs.length);
      const probe: SlideIR = { layout: layout.name, placeholders: map.map((m, i) => ({ idx: m.contentIdx, paragraphs: [{ segments: [{ text: ` ${i}` }] }] })) };
      const b = bindContentByRole(probe, layout.placeholders);
      map.forEach((m, i) => expect(txt(b.get(m.phIdx)), `${layout.name} ph ${m.phIdx} no round-trip`).toBe(` ${i}`));
    }
  });
});
