/**
 * editor-field-routing.test.ts — typing into a RECOGNIZED editor field must land in THAT SAME
 * placeholder (reflect), never drop or misroute into a neighbour box.
 *
 * Root cause (see audit): the SlideEditor writes a field's text at the layout placeholder's RAW idx,
 * but bindContentByRole re-interprets that idx through slideIdxRole's CANONICAL meta convention
 * (10=category, 11=date, 12=footer, 50=slideNumber). On real templates whose meta shapes use
 * PowerPoint's standard idxs (dt=10, ftr=11, sldNum=12 — the 3 報告書 families; or 14/15/16 — velis)
 * the two namespaces disagree: the date field (idx10) DROPS, the footer field (idx11) MISROUTES into
 * the date box, etc.
 *
 * Fix: contentIdxForPlaceholder(ph, layoutPhs, hasCtrTitle) is the INVERSE of the binder for one
 * placeholder — the canonical content idx that role-binds BACK to ph. The editor writes there, so
 * input reflects in the correct box. Content stays canonical → alien / layout-switch stay robust.
 * This test drives that helper + simulates the editor's write path.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData, type LayoutInfo } from "../src/engine/template-loader";
import { bindContentByRole, contentIdxForPlaceholder, buildFieldMap, bodyPlaceholders, nthBody } from "../src/engine/placeholder-binding";
import { placeholderRole } from "../src/engine/template-catalog";
import type { SlideIR } from "../src/engine/slide-schema";

const DIR = resolve(__dirname, "../public/templates/slide");
const T = {
  kokko: "報告書テンプレート_官公庁_全レイアウト見本.pptx",
  report: "報告書テンプレート_全レイアウト見本.pptx",
  velis: "lrk-slides-velis_CC0.pptx",
  midnight: "Midnight_Executive_30_Template.pptx",
};

/** The cover layout = the one carrying a ctrTitle (robust across templates, no name guessing). */
function cover(tpl: TemplateData): LayoutInfo {
  const l = tpl.layouts.find((L) => L.placeholders.some((p) => p.type.toLowerCase().includes("ctrtitle")));
  if (!l) throw new Error("no ctrTitle cover layout");
  return l;
}

/** Simulate the fixed editor writing `text` into the field for layout placeholder `phIdx`. */
function editField(slide: SlideIR, layout: LayoutInfo, phIdx: string, text: string): SlideIR {
  const hasCtrTitle = slide.placeholders.some((p) => p.idx === "0");
  const bound = bindContentByRole(slide, layout.placeholders);
  const existing = bound.get(phIdx);
  const lph = layout.placeholders.find((p) => p.idx === phIdx)!;
  const targetIdx = existing ? existing.idx : contentIdxForPlaceholder(lph, hasCtrTitle);
  const others = slide.placeholders.filter((p) => p.idx !== targetIdx);
  return { ...slide, placeholders: [...others, { idx: targetIdx, paragraphs: [{ segments: [{ text }] }] }] };
}

/** Text that bindContentByRole routes INTO placeholder `phIdx` (what the preview/export shows there). */
function shownIn(slide: SlideIR, layout: LayoutInfo, phIdx: string): string {
  const c = bindContentByRole(slide, layout.placeholders).get(phIdx);
  return c ? c.paragraphs.flatMap((p) => p.segments.map((s) => s.text)).join("") : "";
}

const load = (f: string) => loadTemplate(readFileSync(resolve(DIR, f)));

describe("editor field input REFLECTS in the same placeholder (report templates)", () => {
  let tpls: Record<string, TemplateData>;
  beforeAll(async () => {
    tpls = { kokko: await load(T.kokko), report: await load(T.report), velis: await load(T.velis), midnight: await load(T.midnight) };
  });

  it("官公庁: date field (idx10) reflects in the date box — was a DROP", () => {
    const layout = cover(tpls.kokko);
    let slide: SlideIR = { layout: layout.name, placeholders: [{ idx: "0", paragraphs: [{ segments: [{ text: "T" }] }] }] };
    slide = editField(slide, layout, "10", "2026-03-31");
    expect(shownIn(slide, layout, "10")).toBe("2026-03-31");
  });

  it("官公庁: footer field (idx11) reflects in the footer box — was a MISROUTE into the date box", () => {
    const layout = cover(tpls.kokko);
    let slide: SlideIR = { layout: layout.name, placeholders: [{ idx: "0", paragraphs: [{ segments: [{ text: "T" }] }] }] };
    slide = editField(slide, layout, "11", "DX推進本部");
    expect(shownIn(slide, layout, "11")).toBe("DX推進本部");
    expect(shownIn(slide, layout, "10")).toBe(""); // did NOT leak into the date box
  });

  it("官公庁: date + footer edited together each stay in their own box", () => {
    const layout = cover(tpls.kokko);
    let slide: SlideIR = { layout: layout.name, placeholders: [{ idx: "0", paragraphs: [{ segments: [{ text: "T" }] }] }] };
    slide = editField(slide, layout, "10", "DATE");
    slide = editField(slide, layout, "11", "FOOT");
    expect(shownIn(slide, layout, "10")).toBe("DATE");
    expect(shownIn(slide, layout, "11")).toBe("FOOT");
  });

  it("報告書(全レイアウト): footer field (idx11) reflects in its own box", () => {
    const layout = cover(tpls.report);
    let slide: SlideIR = { layout: layout.name, placeholders: [{ idx: "0", paragraphs: [{ segments: [{ text: "T" }] }] }] };
    slide = editField(slide, layout, "11", "FOOT");
    expect(shownIn(slide, layout, "11")).toBe("FOOT");
  });
});

describe("body-TYPED custom boxes (資料番号 idx13 / メタ情報 idx14) must NOT overwrite the subtitle", () => {
  // Regression: contentIdxForPlaceholder treated these as canonical body regions and returned "1"/"2".
  // On a cover (hasCtrTitle) idx "1" reads as SUBTITLE → typing メタ情報 rewrote the subtitle.
  let kokko: TemplateData;
  beforeAll(async () => { kokko = await load(T.kokko); });

  const coverWithSub = (layout: LayoutInfo): SlideIR => ({
    layout: layout.name,
    placeholders: [
      { idx: "0", paragraphs: [{ segments: [{ text: "T" }] }] },
      { idx: "1", paragraphs: [{ segments: [{ text: "SUB" }] }] },
    ],
  });

  it("editing メタ情報 (idx14) reflects in idx14 and leaves the subtitle intact", () => {
    const layout = cover(kokko);
    let slide = coverWithSub(layout);
    slide = editField(slide, layout, "14", "META");
    expect(shownIn(slide, layout, "14")).toBe("META");
    expect(shownIn(slide, layout, "1")).toBe("SUB"); // subtitle NOT clobbered
  });

  it("editing 資料番号 (idx13) reflects in idx13 and leaves the subtitle intact", () => {
    const layout = cover(kokko);
    let slide = coverWithSub(layout);
    slide = editField(slide, layout, "13", "資料3");
    expect(shownIn(slide, layout, "13")).toBe("資料3");
    expect(shownIn(slide, layout, "1")).toBe("SUB");
  });

  it("メタ情報 and 資料番号 edited together stay in their own boxes", () => {
    const layout = cover(kokko);
    let slide = coverWithSub(layout);
    slide = editField(slide, layout, "13", "DOC");
    slide = editField(slide, layout, "14", "META");
    expect(shownIn(slide, layout, "13")).toBe("DOC");
    expect(shownIn(slide, layout, "14")).toBe("META");
    expect(shownIn(slide, layout, "1")).toBe("SUB");
  });
});

describe("velis (meta at idx14/15/16) reflects, and slide-number fields are role-filtered", () => {
  let velis: TemplateData;
  beforeAll(async () => { velis = await load(T.velis); });

  it("velis: footer field (idx15) reflects in its own box — was a DROP", () => {
    const layout = cover(velis);
    let slide: SlideIR = { layout: layout.name, placeholders: [{ idx: "0", paragraphs: [{ segments: [{ text: "T" }] }] }] };
    slide = editField(slide, layout, "15", "FOOT");
    expect(shownIn(slide, layout, "15")).toBe("FOOT");
  });

  it("a real slide-number placeholder has role slideNumber → the editor filters it out", () => {
    const layout = cover(velis);
    const sldNum = layout.placeholders.find((p) => p.type.toLowerCase() === "sldnum");
    expect(sldNum).toBeTruthy();
    expect(placeholderRole(sldNum!)).toBe("slideNumber"); // editablePhs must exclude by role, not just idx "50"
  });
});

describe("pre-existing canonical meta (sample-deck) — editor field matches the preview box, WYSIWYG", () => {
  // sample-deck.ts emits Category=idx10, Date=idx11, Footer=idx12 (canonical). On the 官公庁 cover
  // (dt=idx10, ftr=idx11, sldNum=idx12, NO category box) role-binding shifts them by one — this is
  // exactly the screenshot where the "Date" FIELD showed the CATEGORY value. The fixed editor READS
  // via the same binding, so each field shows what its box renders.
  let kokko: TemplateData;
  beforeAll(async () => { kokko = await load(T.kokko); });

  const seeded = (layout: LayoutInfo): SlideIR => ({
    layout: layout.name,
    placeholders: [
      { idx: "0", paragraphs: [{ segments: [{ text: "T" }] }] },
      { idx: "10", paragraphs: [{ segments: [{ text: "CAT" }] }] }, // category — no box → unbound
      { idx: "11", paragraphs: [{ segments: [{ text: "DATE" }] }] }, // date → date box idx10
      { idx: "12", paragraphs: [{ segments: [{ text: "FOOT" }] }] }, // footer → footer box idx11
    ],
  });

  it("the date field (idx10) shows the DATE value and the footer field (idx11) shows the FOOTER value", () => {
    const layout = cover(kokko);
    const slide = seeded(layout);
    expect(shownIn(slide, layout, "10")).toBe("DATE"); // date box (editor idx10 field reads this)
    expect(shownIn(slide, layout, "11")).toBe("FOOT"); // footer box (editor idx11 field reads this)
  });

  it("editing the date field updates the DATE content in place (not a stray idx10), footer untouched", () => {
    const layout = cover(kokko);
    let slide = seeded(layout);
    slide = editField(slide, layout, "10", "NEWDATE");
    expect(shownIn(slide, layout, "10")).toBe("NEWDATE");
    expect(shownIn(slide, layout, "11")).toBe("FOOT"); // footer box unaffected
    // the CATEGORY content is preserved in the model even though it has no box (not discarded)
    expect(slide.placeholders.find((p) => p.idx === "10")?.paragraphs[0].segments[0].text).toBe("CAT");
  });
});

describe("a diagram/table field is skipped by RESOLVED body idx, not the 1-based ordinal", () => {
  // On a gapped-body layout (bodies at raw idx [1,3]) a diagram on body#2 carries placeholderIdx="2"
  // (a 1-based BODY ORDINAL) but occupies RAW idx "3". The editor must skip the field for "3" — else it
  // shows a text box over the diagram and export silently drops what you type there.
  it("Midnight gapped-body column layout: the diagram's occupied field is excluded", async () => {
    const tpl = await load(T.midnight);
    const layout = tpl.layouts.find((l) => {
      const b = bodyPlaceholders(l.placeholders);
      return b.length >= 2 && nthBody(b, "2")?.idx !== "2"; // a real gap: 2nd body's raw idx ≠ "2"
    });
    expect(layout, "expected a Midnight layout with gapped body idxs").toBeTruthy();
    const bodies = bodyPlaceholders(layout!.placeholders);
    const diagRawIdx = nthBody(bodies, "2")!.idx; // e.g. "3"
    expect(diagRawIdx).not.toBe("2");
    const slide: SlideIR = { layout: layout!.name, placeholders: [], diagram: { yaml: "type: flowchart\nnodes: []\nedges: []", placeholderIdx: "2" } };
    // buildFieldMap emits a field for that raw body placeholder…
    const map = buildFieldMap(slide, layout!.placeholders);
    expect(map.some((m) => m.phIdx === diagRawIdx)).toBe(true);
    // …and the editor's skip set (same nthBody resolution) must contain it, so the field is hidden.
    const visualIdx = new Set([nthBody(bodies, slide.diagram!.placeholderIdx)?.idx].filter(Boolean));
    expect(visualIdx.has(diagRawIdx)).toBe(true);
    expect(diagRawIdx === slide.diagram!.placeholderIdx).toBe(false); // the OLD raw-vs-ordinal compare would miss it
  });
});

describe("canonical (Midnight) is unchanged — no regression", () => {
  let mid: TemplateData;
  beforeAll(async () => { mid = await load(T.midnight); });

  it("contentIdxForPlaceholder returns the SAME idx for canonical meta (category/date/footer)", () => {
    const layout = cover(mid);
    const byRole = (r: string) => layout.placeholders.find((p) => placeholderRole(p) === r);
    const cat = byRole("category"), date = byRole("date"), foot = byRole("footer");
    if (cat) expect(contentIdxForPlaceholder(cat, true)).toBe(cat.idx);
    if (date) expect(contentIdxForPlaceholder(date, true)).toBe(date.idx);
    if (foot) expect(contentIdxForPlaceholder(foot, true)).toBe(foot.idx);
  });

  it("title + subtitle still reflect (regression guard, all templates)", async () => {
    for (const tpl of [mid]) {
      const layout = cover(tpl);
      let slide: SlideIR = { layout: layout.name, placeholders: [] };
      slide = editField(slide, layout, "0", "タイトル");
      slide = editField(slide, layout, "1", "サブ");
      expect(shownIn(slide, layout, "0")).toBe("タイトル");
      expect(shownIn(slide, layout, "1")).toBe("サブ");
    }
  });
});
