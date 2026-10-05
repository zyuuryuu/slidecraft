/**
 * kicker-row.test.ts — #404 `Kicker:` (the small category line above a content slide's title,
 * "SECTION 02 · コスト分析") rides the #397/#398 FIELD-ROW mechanism (field-rows.ts) as a third row:
 *   `Kicker: …` → canonical content idx "kicker" → the auto pick prefers a variant with a Kicker/Eyebrow
 *   slot (field-variant.ts) → binding Pass 0 puts it there (by the slot's NAME).
 *
 * Measured on every committed template (built-in 30, the 13-layout report family, lrk, Dirty fixtures):
 * NO content layout has a kicker slot — kicker-like boxes exist only on title/section/closing layouts
 * (Midnight CategoryLabel.Top / SectionLabel.Top = idx 10 = the existing `Category:`). So:
 *   - with no slot the row degrades NEVER-SILENTLY (unbound-content naming `Kicker:`), like #421;
 *   - a template that has the slot is synthesized here (a `Kicker.Top` placeholder injected into a real
 *     layout's XML) to prove the row lands above the title end to end.
 * Invariants: a deck without the row is unchanged; title-side `Category:` keeps its meaning (idx 10,
 * title namespace); the row round-trips; the AI is told about it only when the template can hold it.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, autoSelectLayout, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { bindContentByRole, resolveBinding, buildFieldMap } from "../src/engine/placeholder-binding";
import { slideBindingPlan } from "../src/engine/group-binding";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { generatePptx } from "../src/engine/placeholder-filler";
import { fieldSlotOf } from "../src/engine/field-rows";
import { slideSystemPrompt } from "../src/engine/llm-prompts";
import type { DeckIR, SlideIR } from "../src/engine/slide-schema";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const GIJUTSU = resolve(__dirname, "../public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx");
const GIJUTSU_BODY = "02_本文（1カラム）"; // title at y=0.42in — room above it for a one-line kicker

const KICKER_MD = "# コスト構造の内訳\n\n- 人件費が 6 割\n- 外注費が増加\n\nKicker: SECTION 02 · コスト分析";
const ROWLESS_MD = "# コスト構造の内訳\n\n- 人件費が 6 割\n- 外注費が増加";

const text = (s: SlideIR, idx: string) =>
  s.placeholders.find((p) => p.idx === idx)?.paragraphs.map((p) => p.segments.map((x) => x.text).join("")).join("\n");
const boundText = (m: Map<string, { paragraphs: SlideIR["placeholders"][number]["paragraphs"] }>, idx: string) =>
  m.get(idx)?.paragraphs.map((p) => p.segments.map((x) => x.text).join("")).join("\n");
/** Put the slide at index 1 of a 3-slide deck so the index-0 cover coercion never interferes. */
const asMiddle = (s: SlideIR): DeckIR => ({ slides: [{ layout: "auto", placeholders: [] }, s, { layout: "auto", placeholders: [] }] });
const pick = (tpl: TemplateData, s: SlideIR) => autoSelectLayout(s, 1, 3, buildCatalog(tpl));

const EMU = (inch: number) => Math.round(inch * 914400);
/** A copy of `file` whose layout `layoutName` carries an extra `Kicker.Top` body placeholder at
 *  (x, y, w, h) inches — the slot a kicker-aware template would offer. */
async function withKickerSlot(file: string, layoutName: string, box: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const paths = Object.keys(zip.files).filter((p) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p));
  for (const p of paths) {
    const xml = await zip.file(p)!.async("string");
    if (!xml.includes(`<p:cSld name="${layoutName}"`)) continue;
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="900" name="Kicker.Top"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>`
      + `<p:nvPr><p:ph type="body" sz="quarter" idx="40"/></p:nvPr></p:nvSpPr>`
      + `<p:spPr><a:xfrm><a:off x="${EMU(box.x)}" y="${EMU(box.y)}"/><a:ext cx="${EMU(box.w)}" cy="${EMU(box.h)}"/></a:xfrm></p:spPr>`
      + `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr marL="0" indent="0"><a:buNone/></a:pPr><a:r><a:rPr lang="ja-JP" sz="1200"/><a:t>KICKER</a:t></a:r></a:p></p:txBody></p:sp>`;
    zip.file(p, xml.replace(/(<p:spTree>[\s\S]*?<\/p:grpSpPr>)/, `$1${sp}`));
    return zip.generateAsync({ type: "nodebuffer" });
  }
  throw new Error(`layout ${layoutName} not found`);
}

describe("parser — Kicker: is a field row (its own canonical content, not body, not meta)", () => {
  it("Kicker: → idx 'kicker', removed from the body", () => {
    const s = parseMd(KICKER_MD).slides[0];
    expect(text(s, "kicker")).toBe("SECTION 02 · コスト分析");
    expect(text(s, "1")).not.toContain("Kicker");
    expect(text(s, "1")).toContain("人件費が 6 割");
  });

  it("does NOT promote the slide to the title namespace (unlike Category:)", () => {
    const s = parseMd(KICKER_MD).slides[0];
    expect(text(s, "15")).toBe("コスト構造の内訳");
    expect(s.placeholders.some((p) => p.idx === "0" || p.idx === "10")).toBe(false);
  });

  it("title-side Category: keeps its meaning (idx 10, title namespace) — no kicker content", () => {
    const s = parseMd("# 年次報告\n\nCategory: 経営企画部\nDate: 2026-10").slides[0];
    expect(text(s, "10")).toBe("経営企画部");
    expect(text(s, "0")).toBe("年次報告");
    expect(s.placeholders.some((p) => p.idx === "kicker")).toBe(false);
  });

  it("case-insensitive key; repeated rows stack as paragraphs (no silent drop)", () => {
    const s = parseMd("# T\n\n- a\n\nkicker: 第 2 章\nKICKER: コスト").slides[0];
    expect(text(s, "kicker")).toBe("第 2 章\nコスト");
  });

  it("inside a code fence the line stays code", () => {
    const s = parseMd("# T\n\n```log\nKicker: not a field\n```").slides[0];
    expect(s.placeholders.some((p) => p.idx === "kicker")).toBe(false);
    expect(s.code?.content).toBe("Kicker: not a field");
  });

  it("a grouped slide lifts the row out of the last column", () => {
    const s = parseMd("# 比較\n\n<!-- card -->\n### A\n- a\n\n<!-- card -->\n### B\n- b\n\nKicker: SECTION 03").slides[0];
    expect(text(s, "kicker")).toBe("SECTION 03");
    expect(text(s, "2")).not.toContain("Kicker");
  });

  it("a deck WITHOUT the row produces no kicker content", () => {
    const s = parseMd(ROWLESS_MD).slides[0];
    expect(s.placeholders.map((p) => p.idx).sort()).toEqual(["1", "15"]);
  });
});

describe("a template WITH a kicker slot — the row is drawn above the title", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(await withKickerSlot(GIJUTSU, GIJUTSU_BODY, { x: 0.6, y: 0.1, w: 6, h: 0.3 }));
  });

  it("the catalog advertises the slot, and adding it leaves the layout's body count / role alone", async () => {
    const plain = buildCatalog(await loadTemplate(readFileSync(GIJUTSU))).find((e) => e.name === GIJUTSU_BODY)!;
    const entry = buildCatalog(tpl).find((e) => e.name === GIJUTSU_BODY)!;
    expect(entry.fieldSlots?.map((f) => f.kind)).toEqual(["kicker"]);
    expect(entry.role).toBe(plain.role);
    expect(entry.bodyCount).toBe(plain.bodyCount);
  });

  it("binding puts the row into Kicker.Top and the bullets into the body; nothing unbound", () => {
    const s = parseMd(KICKER_MD).slides[0];
    const name = pick(tpl, s);
    expect(name).toBe(GIJUTSU_BODY);
    const layout = findLayout(tpl, name)!;
    const slot = layout.placeholders.find((p) => p.name === "Kicker.Top")!;
    const bound = bindContentByRole(s, layout.placeholders);
    expect(boundText(bound, slot.idx)).toBe("SECTION 02 · コスト分析");
    expect(resolveBinding(s, layout.placeholders).unbound).toEqual([]);
  });

  it("the exported PPTX draws the kicker in Kicker.Top, ABOVE the title", async () => {
    const zip = await JSZip.loadAsync(await generatePptx(asMiddle(parseMd(KICKER_MD).slides[0]), tpl));
    const xml = await zip.file("ppt/slides/slide2.xml")!.async("string");
    const sps = xml.split("<p:sp>");
    const kicker = sps.find((x) => x.includes("SECTION 02 · コスト分析"));
    expect(kicker).toBeDefined();
    expect(kicker).toMatch(/<p:ph[^>]*idx="40"/);
    const layout = findLayout(tpl, GIJUTSU_BODY)!;
    const slot = layout.placeholders.find((p) => p.name === "Kicker.Top")!;
    const title = layout.placeholders.find((p) => p.type.toLowerCase() === "title")!;
    expect(slot.style.y + slot.style.h).toBeLessThanOrEqual(title.style.y);
  });

  it("the row-less slide is unchanged by the slot: same pick, the slot stays empty", () => {
    const s = parseMd(ROWLESS_MD).slides[0];
    const layout = findLayout(tpl, pick(tpl, s))!;
    const slot = layout.placeholders.find((p) => p.name === "Kicker.Top");
    const bound = bindContentByRole(s, layout.placeholders);
    if (slot) expect(bound.has(slot.idx)).toBe(false);
    expect(diagnoseDeck(asMiddle(s), buildCatalog(tpl), tpl.layouts).filter((i) => i.id === "unbound-content")).toEqual([]);
  });

  it("the editor field map writes the Kicker.Top box back as a Kicker: row", () => {
    const layout = findLayout(tpl, GIJUTSU_BODY)!;
    const slot = layout.placeholders.find((p) => p.name === "Kicker.Top")!;
    expect(fieldSlotOf(slot)).toBe("kicker");
    const fm = buildFieldMap({ layout: GIJUTSU_BODY, placeholders: [] }, layout.placeholders);
    expect(fm.find((f) => f.phIdx === slot.idx)?.contentIdx).toBe("kicker");
  });

  it("the AI is told about Kicker: on this template", () => {
    expect(slideSystemPrompt(buildCatalog(tpl))).toContain("Kicker:");
  });
});

describe("variant preference — the auto pick moves to the variant that has the slot", () => {
  it("Midnight with Kicker.Top only on +1Notes: a kicker slide picks +1Notes, a row-less one stays", async () => {
    const tpl = await loadTemplate(await withKickerSlot(MIDNIGHT, "Content.1Body.Single+1Notes", { x: 10.9, y: 0.1, w: 2.2, h: 0.3 }));
    expect(pick(tpl, parseMd(KICKER_MD).slides[0])).toBe("Content.1Body.Single+1Notes");
    expect(pick(tpl, parseMd(ROWLESS_MD).slides[0])).toBe("Content.1Body.Single");
  });
});

describe("never-silent degrade — no kicker slot (every committed template today)", () => {
  for (const [label, file] of [["Midnight", MIDNIGHT], ["技術報告", GIJUTSU]] as const) {
    it(`${label}: the pick is unchanged and the row is reported by name, not dropped silently`, async () => {
      const tpl = await loadTemplate(readFileSync(file));
      const catalog = buildCatalog(tpl);
      const deck = asMiddle(parseMd(KICKER_MD).slides[0]);
      expect(pick(tpl, deck.slides[1])).toBe(pick(tpl, parseMd(ROWLESS_MD).slides[0]));
      const layout = findLayout(tpl, autoSelectLayout(deck.slides[1], 1, 3, catalog))!;
      expect(slideBindingPlan(deck.slides[1], layout).unbound.map((u) => u.idx)).toEqual(["kicker"]);
      const issues = diagnoseDeck(deck, catalog, tpl.layouts).filter((i) => i.id === "unbound-content");
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain("Kicker:");
    });
  }

  it("the row-less deck gains no diagnostic", async () => {
    const tpl = await loadTemplate(readFileSync(MIDNIGHT));
    const deck = asMiddle(parseMd(ROWLESS_MD).slides[0]);
    expect(diagnoseDeck(deck, buildCatalog(tpl), tpl.layouts).filter((i) => i.id === "unbound-content")).toEqual([]);
  });
});

describe("authoring contract — Kicker: is advertised only where it takes effect", () => {
  it("templates without the slot (Midnight, 技術報告) do not advertise it; Takeaway/Source unchanged", async () => {
    const mid = slideSystemPrompt(buildCatalog(await loadTemplate(readFileSync(MIDNIGHT))));
    expect(mid).not.toContain("Kicker:");
    expect(mid).toContain("Takeaway:");
    expect(mid).toContain("Source:");
    expect(slideSystemPrompt(buildCatalog(await loadTemplate(readFileSync(GIJUTSU))))).not.toContain("Kicker:");
  });

  it("no template loaded (the canonical built-in set, which has no kicker slot) → not advertised", () => {
    const p = slideSystemPrompt();
    expect(p).not.toContain("Kicker:");
    expect(p).toContain("Takeaway:");
    expect(p).toContain("Source:");
  });
});

describe("round-trip — the row survives serialize → parse, with and without a template", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(MIDNIGHT));
  });

  const MDS = [KICKER_MD, "# T\n\n- a\n\nKicker: **第 2 章**\nKicker: コスト\nTakeaway: 結論\nSource: 出典A",
    "# 比較\n\n<!-- card -->\n### A\n- a\n\n<!-- card -->\n### B\n- b\n\nKicker: SECTION 03"];
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
