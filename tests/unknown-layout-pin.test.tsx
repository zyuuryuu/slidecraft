/**
 * unknown-layout-pin.test.tsx — #435: `<!-- slide: X -->` naming a layout THIS template lacks (a
 * built-in name, a typo, another template's name). export (placeholder-filler) and the app preview
 * (SlidePreview) both resolve through autoSelectLayout, which degrades the unknown pin to the auto
 * pick — but (1) nothing told the author, and (2) other consumers used a SECOND resolution
 * (`layout === "auto" ? autoSelectLayout(…) : layout`) that kept the unknown name: the deck
 * serializer then read a 2-column slide through the unknown name and wrote no `<!-- col -->` (the
 * columns merge on round-trip), the per-slide readout disagreed with export, and MCP set_diagram
 * rejected a body-bearing slide.
 * Locks: one resolution (autoSelectLayout) everywhere (R8) + warn `unknown-layout-pin`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import { loadTemplate, autoSelectLayout, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";
import { generatePptx } from "../src/engine/placeholder-filler";
import SlidePreview from "../src/components/SlidePreview";
import * as S from "../src/mcp/session";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

// The issue's repro, verbatim (a built-in name pinned on Midnight).
const REPRO = "<!-- slide: title-centered -->\n# 月次脅威情報報告\n## サブ\nCategory: X";
// A 2-column slide pinned to an unknown name — export draws it on a 2-column layout, but the old
// serializer path read it through the unknown NAME and wrote no `<!-- col -->` (columns merged).
const TWO_COL = "# 表紙\n\n---\n\n<!-- slide: two-content -->\n# 比較\n\n<!-- col -->\n- 左A\n- 左B\n\n<!-- col -->\n- 右C";
// Real pins + auto only — must stay diagnostic-free.
const HEALTHY =
  "<!-- slide: Title.1Title.Single -->\n# 表紙\n## サブ\n\n---\n\n<!-- slide: Column.2Body.Equal -->\n# 比較\n\n- 速い\n\n<!-- col -->\n\n- 安い\n\n---\n\n# 内容\n\n- 要点";

let tpl: TemplateData;
let catalog: LayoutCatalog;
beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(MIDNIGHT));
  catalog = buildCatalog(tpl);
});

const pinIssues = (md: string, withLayouts = true) =>
  diagnoseDeck(parseMd(md), catalog, withLayouts ? tpl.layouts : undefined).filter((x) => x.id === "unknown-layout-pin");

function session(md: string) {
  const s = S.createSession(null);
  s.deck = parseMd(md);
  s.template = tpl;
  s.catalog = catalog;
  return s;
}

describe("unknown layout pin — ONE resolution shared by export / preview / readouts (#435, R8)", () => {
  it("export and the app preview draw the SAME layout: the auto pick (not a blank slide)", async () => {
    const deck = parseMd(REPRO);
    const name = autoSelectLayout(deck.slides[0], 0, 1, catalog);
    // The unknown pin degrades exactly like an unpinned slide would.
    expect(name).toBe(autoSelectLayout({ ...deck.slides[0], layout: "auto" }, 0, 1, catalog));
    const layout = findLayout(tpl, name)!;
    expect(layout).toBeDefined();
    // export: the slide's layout rel points at that layout's part.
    const z = await JSZip.loadAsync(await generatePptx(deck, tpl));
    const rels = await z.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(rels).toContain(`slideLayouts/slideLayout${layout.index}.xml`);
    // preview: the real SlidePreview renders the slide's text (it was reported blank).
    const html = renderToStaticMarkup(createElement(SlidePreview, { deck, template: tpl, error: null, singleSlide: true, activeSlide: 0, scale: 60 }));
    expect(html).toContain("月次脅威情報報告");
    expect(html).toContain("サブ");
  });

  it("deck serializer round-trips an unknown-pinned 2-column slide (was: columns merged into one body)", () => {
    const deck = parseMd(TWO_COL);
    expect(autoSelectLayout(deck.slides[1], 1, 2, catalog)).toBe("Column.2Body.Equal"); // what export draws
    const md = serializeMd(deck, { catalog, layouts: tpl.layouts });
    expect(md).toContain("<!-- col -->");
    // The author's directive is preserved verbatim (do-no-harm: switching back to a template that has
    // the name keeps the pin).
    expect(md).toContain("<!-- slide: two-content -->");
    expect(parseMd(md).slides.map((x) => x.placeholders)).toEqual(deck.slides.map((x) => x.placeholders));
  });

  it("per-slide readout (MCP get_slide_markdown) names the layout export actually uses, with all content", () => {
    const s = session(TWO_COL);
    const resolved = autoSelectLayout(s.deck!.slides[1], 1, 2, catalog);
    const md = S.getSlideMarkdown(s, 1);
    expect(md).toContain(`<!-- slide: ${resolved} -->`);
    for (const text of ["左A", "左B", "右C"]) expect(md).toContain(text);
  });

  it("MCP set_diagram places a figure on an unknown-pinned body slide (was: rejected 'no body region')", () => {
    const md = (pin: string) => `# 表紙\n\n---\n\n<!-- slide: ${pin} -->\n# 内容\n\n本文`;
    const s = session(md("bogus-name"));
    const resolved = autoSelectLayout(s.deck!.slides[1], 1, 2, catalog);
    const r = S.setDiagram(s, 1, "flowchart TD\n  A[開始]-->B[終了]", "mermaid");
    expect(r).toMatchObject({ ok: true });
    // Same placement as a slide pinned to the layout export actually draws (agreement, R8).
    const control = session(md(resolved));
    expect(S.setDiagram(control, 1, "flowchart TD\n  A[開始]-->B[終了]", "mermaid")).toMatchObject({ ok: true });
    expect(s.deck!.slides[1].diagram).toEqual(control.deck!.slides[1].diagram);
  });
});

describe("diagnoseDeck — unknown-layout-pin (#435)", () => {
  it("issue repro → exactly 1 warn naming the pin, the substitute, and candidates", () => {
    const issues = pinIssues(REPRO);
    expect(issues).toHaveLength(1);
    const [x] = issues;
    expect(x.slideIndex).toBe(0);
    expect(x.title).toBe("月次脅威情報報告");
    expect(x.level).toBe("warn");
    expect(x.level).toBe(REVIEW_RULES.find((r) => r.id === "unknown-layout-pin")!.level);
    expect(x.levers).toEqual([]);
    const substitute = autoSelectLayout(parseMd(REPRO).slides[0], 0, 1, catalog);
    expect(x.message).toContain("「title-centered」");
    expect(x.message).toContain(`「${substitute}」`);
    const others = x.message.match(/他の候補: (.+)）$/)![1].split(" / ");
    expect(others.length).toBeGreaterThan(0);
    expect(others).not.toContain(substitute); // the substitute isn't re-listed as an alternative
    for (const n of others) expect(catalog.some((e) => e.name === n)).toBe(true); // real names only
  });

  it("fires with the catalog alone (the GUI's diagnoseDeck(deck, catalog) call) — once, not twice", () => {
    expect(pinIssues(REPRO, false)).toHaveLength(1);
    expect(pinIssues(REPRO, true)).toHaveLength(1);
  });

  it("one warn per unknown-pinned slide, on the right slide", () => {
    const issues = pinIssues(TWO_COL);
    expect(issues.map((x) => x.slideIndex)).toEqual([1]);
    expect(issues[0].message).toContain("「two-content」");
  });

  // ── 負側：実在 pin・auto では増えない ──
  it("real pins + auto → 0 unknown-layout-pin, and the deck stays fully issue-free", () => {
    expect(pinIssues(HEALTHY)).toEqual([]);
    expect(diagnoseDeck(parseMd(HEALTHY), catalog, tpl.layouts)).toEqual([]);
    expect(diagnoseDeck(parseMd(HEALTHY), catalog)).toEqual([]);
  });

  it("no template (no catalog) → 0: whether a name exists is unknowable", () => {
    expect(diagnoseDeck(parseMd(REPRO)).filter((x) => x.id === "unknown-layout-pin")).toEqual([]);
  });
});

// ── R8 agreement: the warn is read off autoSelectLayout; here it is checked against an INDEPENDENT
// membership test (pin ∉ catalog names) over every committed fixture template × committed sample deck
// (committed corpus only — no gitignored templates, so local = CI).
describe("unknown-layout-pin agreement over the committed corpus (R8)", () => {
  it("warn fires on a slide iff its pin is absent from that template's catalog", async () => {
    const tdir = resolve(__dirname, "fixtures/templates");
    const sdir = resolve(__dirname, "../samples");
    const decks = readdirSync(sdir).filter((f) => f.endsWith(".md") && f !== "README.md").map((f) => parseMd(readFileSync(resolve(sdir, f), "utf8")));
    let unknownSeen = 0, knownPinSeen = 0;
    for (const tf of readdirSync(tdir).filter((f) => f.endsWith(".pptx"))) {
      const cat = buildCatalog(await loadTemplate(readFileSync(resolve(tdir, tf))));
      const names = new Set(cat.map((e) => e.name));
      for (const deck of decks) {
        const warned = new Set(diagnoseDeck(deck, cat).filter((x) => x.id === "unknown-layout-pin").map((x) => x.slideIndex));
        deck.slides.forEach((sl, i) => {
          const unknown = sl.layout !== "auto" && !names.has(sl.layout);
          if (unknown) unknownSeen++; else if (sl.layout !== "auto") knownPinSeen++;
          expect(warned.has(i), `${tf} slide ${i} pin=${sl.layout}`).toBe(unknown);
        });
      }
    }
    // Both sides of the iff are actually exercised by the corpus.
    expect(unknownSeen).toBeGreaterThan(0);
    expect(knownPinSeen).toBeGreaterThan(0);
  });
});
