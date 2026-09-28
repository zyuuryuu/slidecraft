/**
 * field-rows.test.ts — #397 (`Takeaway:` → +1Callout) / #398 (`Source:` → +1Source).
 *
 * ONE mechanism for both (R8): a field row (`Name: value`, one line) → a canonical content idx
 * ("callout" / "source") → the auto pick prefers a layout variant that HAS a slot for it → binding
 * places it in that slot (Pass 0, by the slot's name). Facts measured on the real templates:
 *   - Midnight `Content.1Body.Single+1Callout`: Callout.Top = body@2 (role body)
 *   - Midnight `Content.1Body.Single+1Source` / `Table.1Table.Single+1Source`: Source.Bottom = body@2
 *     (role "date" — the footer-band geometry reclassifies it; inferredFunction chrome)
 *   - 公文書高密度: `出典` = body@30 (role "date", chrome) on 11 layouts
 * Invariants locked here: a deck WITHOUT field rows parses/binds exactly as before; the row round-trips;
 * a template with no slot degrades never-silently (unbound-content diagnostic naming the row).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, autoSelectLayout, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { bindContentByRole, resolveBinding, buildFieldMap } from "../src/engine/placeholder-binding";
import { slideBindingPlan } from "../src/engine/group-binding";
import { bodyPlaceholders, nthBody } from "../src/engine/visual-placement";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { generatePptx } from "../src/engine/placeholder-filler";
import { fieldSlotOf } from "../src/engine/field-rows";
import { slideSystemPrompt } from "../src/engine/llm-prompts";
import type { DeckIR, SlideIR } from "../src/engine/slide-schema";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const KOUBUNSHO = resolve(__dirname, "../public/templates/slide/配布資料_公文書高密度_TemplateOnly.pptx");
const GIJUTSU = resolve(__dirname, "../public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx");

const TAKEAWAY_MD = "# 売上は回復基調\n\n- 3Q は前年比 +12%\n- 新規顧客が牽引\n\nTakeaway: 結論はこれ";
const TABLE_SOURCE_MD = "# 地域別人口\n\n| 地域 | 人口 |\n|---|---|\n| 東京 | 1400万 |\n\nSource: 総務省 2025";
const BODY_SOURCE_MD = "# 市場規模\n\n- 国内市場は 3 兆円\n\nSource: 業界団体調べ";

const text = (s: SlideIR, idx: string) =>
  s.placeholders.find((p) => p.idx === idx)?.paragraphs.map((p) => p.segments.map((x) => x.text).join("")).join("\n");
const boundText = (m: Map<string, { paragraphs: SlideIR["placeholders"][number]["paragraphs"] }>, idx: string) =>
  m.get(idx)?.paragraphs.map((p) => p.segments.map((x) => x.text).join("")).join("\n");
const pick = (tpl: TemplateData, s: SlideIR, i = 1, n = 3) => autoSelectLayout(s, i, n, buildCatalog(tpl));
/** Put the slide at index 1 of a 3-slide deck so the index-0 cover coercion never interferes. */
const asMiddle = (s: SlideIR): DeckIR => ({ slides: [{ layout: "auto", placeholders: [] }, s, { layout: "auto", placeholders: [] }] });

describe("parser — field rows become their own canonical content (not body)", () => {
  it("Takeaway: → idx 'callout', removed from the body", () => {
    const s = parseMd(TAKEAWAY_MD).slides[0];
    expect(text(s, "callout")).toBe("結論はこれ");
    expect(text(s, "1")).not.toContain("Takeaway");
    expect(text(s, "1")).toContain("3Q は前年比 +12%");
  });

  it("Source: → idx 'source'; the table stays the body figure at ordinal 1", () => {
    const s = parseMd(TABLE_SOURCE_MD).slides[0];
    expect(text(s, "source")).toBe("総務省 2025");
    expect(s.table?.placeholderIdx).toBe("1");
    expect(s.placeholders.some((p) => p.idx === "1")).toBe(false);
  });

  it("a field row does NOT promote the slide to the title namespace (unlike Category/Date/Footer)", () => {
    const s = parseMd(TAKEAWAY_MD).slides[0];
    expect(text(s, "15")).toBe("売上は回復基調");
    expect(s.placeholders.some((p) => p.idx === "0")).toBe(false);
  });

  it("repeated rows of the same field are kept as separate paragraphs (no silent drop)", () => {
    const s = parseMd("# T\n\n- a\n\nSource: 出典A\nSource: 出典B").slides[0];
    expect(text(s, "source")).toBe("出典A\n出典B");
  });

  it("inside a code fence the row is code, not a field", () => {
    const s = parseMd("# T\n\n```log\nSource: not a field\n```").slides[0];
    expect(s.placeholders.some((p) => p.idx === "source")).toBe(false);
    expect(s.code?.content).toBe("Source: not a field");
  });

  it("a grouped slide (<!-- card -->) lifts the row out of the last column", () => {
    const s = parseMd("# 比較\n\n<!-- card -->\n### A\n- a\n\n<!-- card -->\n### B\n- b\n\nSource: 調査X").slides[0];
    expect(text(s, "source")).toBe("調査X");
    expect(text(s, "2")).not.toContain("Source");
  });

  it("a deck WITHOUT field rows produces no field content (byte-identical IR shape)", () => {
    const s = parseMd("# 市場規模\n\n- 国内市場は 3 兆円\n\n出典は下記").slides[0];
    expect(s.placeholders.map((p) => p.idx).sort()).toEqual(["1", "15"]);
  });
});

describe("Midnight — the variant with the slot is picked and the row binds into it", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(MIDNIGHT));
    catalog = buildCatalog(tpl);
  });

  it("Takeaway → Content.1Body.Single+1Callout; Callout.Top gets the row, Body.Center the bullets", () => {
    const s = parseMd(TAKEAWAY_MD).slides[0];
    const name = pick(tpl, s);
    expect(name).toBe("Content.1Body.Single+1Callout");
    const layout = findLayout(tpl, name)!;
    const bound = bindContentByRole(s, layout.placeholders);
    const calloutIdx = layout.placeholders.find((p) => p.name === "Callout.Top")!.idx;
    const bodyIdx = layout.placeholders.find((p) => p.name === "Body.Center")!.idx;
    expect(boundText(bound, calloutIdx)).toBe("結論はこれ");
    expect(boundText(bound, bodyIdx)).toContain("新規顧客が牽引");
    expect(resolveBinding(s, layout.placeholders).unbound).toEqual([]);
  });

  it("table + Source → Table.1Table.Single+1Source; Source.Bottom gets X; the table rides Body.Center", () => {
    const s = parseMd(TABLE_SOURCE_MD).slides[0];
    const name = pick(tpl, s);
    expect(name).toBe("Table.1Table.Single+1Source");
    const layout = findLayout(tpl, name)!;
    const bound = bindContentByRole(s, layout.placeholders);
    expect(boundText(bound, layout.placeholders.find((p) => p.name === "Source.Bottom")!.idx)).toBe("総務省 2025");
    expect(nthBody(bodyPlaceholders(layout.placeholders), s.table!.placeholderIdx)?.name).toBe("Body.Center");
  });

  it("body text + Source → Content.1Body.Single+1Source", () => {
    const s = parseMd(BODY_SOURCE_MD).slides[0];
    expect(pick(tpl, s)).toBe("Content.1Body.Single+1Source");
  });

  it("without the row the pick is unchanged (Content.1Body.Single)", () => {
    expect(pick(tpl, parseMd("# 売上は回復基調\n\n- 3Q は前年比 +12%").slides[0])).toBe("Content.1Body.Single");
    expect(pick(tpl, parseMd("# 地域別人口\n\n| 地域 | 人口 |\n|---|---|\n| 東京 | 1400万 |").slides[0])).toBe("Content.1Body.Single");
  });

  it("an explicit layout pin is honored (the variant preference only acts on auto)", () => {
    const s = parseMd("<!-- slide: Content.1Body.Single -->\n" + TAKEAWAY_MD).slides[0];
    expect(pick(tpl, s)).toBe("Content.1Body.Single");
  });

  it("the exported PPTX carries the row text in the Callout.Top placeholder", async () => {
    const deck = asMiddle(parseMd(TAKEAWAY_MD).slides[0]);
    const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
    const xml = await zip.file("ppt/slides/slide2.xml")!.async("string");
    const sp = xml.split("<p:sp>").find((x) => x.includes("結論はこれ"));
    expect(sp).toBeDefined();
    expect(sp).toMatch(/<p:ph[^>]*idx="2"/);
  });

  it("the editor field map writes the Callout.Top / Source.Bottom boxes back as field rows", () => {
    for (const [layoutName, slotName, idx] of [
      ["Content.1Body.Single+1Callout", "Callout.Top", "callout"],
      ["Table.1Table.Single+1Source", "Source.Bottom", "source"],
    ] as const) {
      const layout = findLayout(tpl, layoutName)!;
      const slot = layout.placeholders.find((p) => p.name === slotName)!;
      const fm = buildFieldMap({ layout: layoutName, placeholders: [] }, layout.placeholders);
      expect(fm.find((f) => f.phIdx === slot.idx)?.contentIdx).toBe(idx);
    }
  });

  it("R8 agreement: every catalog-advertised slot is exactly where binding puts that row", () => {
    for (const entry of catalog) {
      const layout = findLayout(tpl, entry.name)!;
      for (const fs of entry.fieldSlots ?? []) {
        const s: SlideIR = { layout: entry.name, placeholders: [{ idx: fs.kind, paragraphs: [{ segments: [{ text: "X" }] }] }] };
        const [phIdx] = [...bindContentByRole(s, layout.placeholders).keys()];
        expect(fieldSlotOf(layout.placeholders.find((p) => p.idx === phIdx)!)).toBe(fs.kind);
        // …and the catalog's body ordinal for the slot is the one the visual route uses.
        const ord = bodyPlaceholders(layout.placeholders).findIndex((p) => p.idx === phIdx) + 1;
        expect(fs.bodyOrdinal).toBe(ord > 0 ? ord : undefined);
      }
    }
  });
});

describe("round-trip — the row survives serialize → parse, with and without a template", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(MIDNIGHT));
  });

  const MDS = [TAKEAWAY_MD, TABLE_SOURCE_MD, BODY_SOURCE_MD, "# T\n\n- a\n\nTakeaway: **太字**の結論\nSource: 出典A\nSource: 出典B",
    "# 比較\n\n<!-- card -->\n### A\n- a\n\n<!-- card -->\n### B\n- b\n\nSource: 調査X"];
  const strip = (d: DeckIR) => d.slides.map((s) => ({ ...s, sourceLineStart: undefined, sourceLineEnd: undefined }));

  for (const md of MDS) {
    it(`stable: ${JSON.stringify(md.slice(0, 24))}…`, () => {
      const deck = parseMd(md);
      const catalog = buildCatalog(tpl);
      for (const t of [undefined, { catalog, layouts: tpl.layouts }]) {
        const once = serializeMd(deck, t);
        const re = parseMd(once);
        expect(strip(re)).toEqual(strip(deck));
        expect(serializeMd(re, t)).toBe(once);
      }
    });
  }
});

describe("never-silent degrade — no slot in the template", () => {
  it("技術報告 (no callout/source slot): the row is reported, not dropped silently", async () => {
    const tpl = await loadTemplate(readFileSync(GIJUTSU));
    const catalog = buildCatalog(tpl);
    const deck = asMiddle(parseMd(TAKEAWAY_MD).slides[0]);
    const layout = findLayout(tpl, autoSelectLayout(deck.slides[1], 1, 3, catalog))!;
    expect(slideBindingPlan(deck.slides[1], layout).unbound.map((u) => u.idx)).toEqual(["callout"]);
    const issues = diagnoseDeck(deck, catalog, tpl.layouts).filter((i) => i.id === "unbound-content");
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Takeaway");
  });

  it("the healthy no-row deck gains no diagnostic from this change", async () => {
    const tpl = await loadTemplate(readFileSync(GIJUTSU));
    const deck = asMiddle(parseMd("# 売上は回復基調\n\n- 3Q は前年比 +12%").slides[0]);
    expect(diagnoseDeck(deck, buildCatalog(tpl), tpl.layouts).filter((i) => i.id === "unbound-content")).toEqual([]);
  });
});

describe("公文書 — the `出典` box (body@30, every content layout) takes Source:", () => {
  it("binds without a layout change and the auto pick is the same as without the row", async () => {
    const tpl = await loadTemplate(readFileSync(KOUBUNSHO));
    const withRow = parseMd(BODY_SOURCE_MD).slides[0];
    const without = parseMd("# 市場規模\n\n- 国内市場は 3 兆円").slides[0];
    const name = pick(tpl, withRow);
    expect(name).toBe(pick(tpl, without));
    const layout = findLayout(tpl, name)!;
    const bound = bindContentByRole(withRow, layout.placeholders);
    const src = layout.placeholders.find((p) => p.name === "出典")!;
    expect(boundText(bound, src.idx)).toBe("業界団体調べ");
  });
});

describe("authoring contract — the AI is told about the rows this template can hold", () => {
  it("Midnight advertises Takeaway: and Source:", async () => {
    const tpl = await loadTemplate(readFileSync(MIDNIGHT));
    const p = slideSystemPrompt(buildCatalog(tpl));
    expect(p).toContain("Takeaway:");
    expect(p).toContain("Source:");
  });

  it("a template with neither slot does not advertise them", async () => {
    const tpl = await loadTemplate(readFileSync(GIJUTSU));
    const p = slideSystemPrompt(buildCatalog(tpl));
    expect(p).not.toContain("Takeaway:");
    expect(p).not.toContain("Source:");
  });
});
