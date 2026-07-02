/**
 * preview-fidelity.test.ts — the preview reads layout background + decorations from the template.
 * Regressions this locks (all preview-only; export was already faithful):
 *  - a layout's own <p:bg> fill is read (a full-bleed cover panel), not just the master bg;
 *  - decoration fill is the SHAPE's own solidFill (theme-resolved), NOT the first srgbClr anywhere —
 *    so a noFill text box is not painted as a ghost colored rectangle;
 *  - connector lines (<p:cxnSp>) become thin decorations (title/footer rules).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";

const REPORT = resolve(__dirname, "../public/templates/slide/報告書テンプレート_全レイアウト見本.pptx");
const CANON = resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx");

describe("preview fidelity: layout background + decorations", () => {
  let report: TemplateData;
  let canon: TemplateData;
  beforeAll(async () => {
    report = await loadTemplate(readFileSync(REPORT));
    canon = await loadTemplate(readFileSync(CANON));
  });

  it("reads a layout's own <p:bg> fill (the dark-blue cover), else undefined", () => {
    const cover = report.layouts.find((l) => l.name === "00_表紙")!;
    expect(cover.background).toBe("0A5A87"); // full-bleed cover panel — was dropped (white) before
    const body = report.layouts.find((l) => l.name.startsWith("02_本文"))!;
    expect(body.background).toBe("FFFFFF");
  });

  it("does NOT ghost a noFill text box into a filled rectangle", () => {
    const cover = report.layouts.find((l) => l.name === "00_表紙")!;
    // covermeta is a noFill text box colored E8F4FA — it must NOT become a decoration.
    expect(cover.decorations.some((d) => d.color === "E8F4FA")).toBe(false);
    // the real rounded motif shapes ARE decorations, with a corner radius.
    expect(cover.decorations.some((d) => d.color === "7FD4F5" && (d.radius ?? 0) > 0)).toBe(true);
  });

  it("renders non-placeholder static TEXT labels (design labels), none spurious on the canonical", async () => {
    // A real design label is a non-placeholder <p:sp> with text — the velis master carries some.
    const velis = await loadTemplate(readFileSync(resolve(__dirname, "../public/templates/slide/lrk-slides-velis_CC0.pptx")));
    const labels = velis.layouts.flatMap((l) => l.staticTexts);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((t) => t.text.trim().length > 0)).toBe(true);
    // the canonical master has no stray text boxes → no spurious static texts (no ghost labels).
    expect(canon.layouts.reduce((n, l) => n + l.staticTexts.length, 0)).toBe(0);
  });

  it("captures connector lines (<p:cxnSp>) as thin decorations", () => {
    const withLine = report.layouts.find((l) => l.decorations.some((d) => d.h < 0.05 && d.w > 5));
    expect(withLine).toBeDefined(); // e.g. the full-width title/footer rules
  });

  it("honors the LAYOUT's own paragraph alignment (lvl1pPr algn), not just the master's", () => {
    // The report cover's title sets algn="l" in <a:lvl1pPr> while the master's titleStyle is "ctr".
    // The layout override must win (left) — the old regex matched no pPr element so align was ALWAYS
    // inherited from the master → a left-aligned title rendered centered.
    const cover = report.layouts.find((l) => l.name === "00_表紙")!;
    const title = cover.placeholders.find((p) => p.type === "ctrTitle")!;
    expect(title.style.align).toBe("l");
    // The subtitle authors lvl2-9 (algn="ctr", schemeClr) BEFORE lvl1 (algn="l", sz=1800, srgb) —
    // EVERY text property (align/size/color) must come from lvl1, not the first level encountered.
    const sub = cover.placeholders.find((p) => p.type === "subTitle")!;
    expect(sub.style.align).toBe("l");
    expect(sub.style.fontSize).toBe(18); // lvl1's 1800, not lvl2's (which has no sz → would fall to master)
    expect(sub.style.fontColor).toBe("E8F4FA"); // lvl1's srgb, not lvl2's schemeClr tx1
    // …and the canonical (size held outside a lvl1 block) keeps its real title/subtitle sizes.
    const cTitle = canon.layouts[6].placeholders.find((p) => p.type === "title" || p.idx === "15");
    expect(cTitle?.style.fontSize).toBe(28);
  });

  it("a canonical-pinned cover resolves to a REAL layout with its background (not blank)", () => {
    // The sample cover is pinned `<!-- slide: Title.1Title.Single -->` — a name this template lacks.
    // The preview/thumbnail must resolve it via autoSelectLayout (degrade → 00_表紙) so it isn't
    // left layout-less (blank white). Regression: SlideList/SlidePreview used slide.layout directly.
    const cat = buildCatalog(report);
    const cover = parseMd("<!-- slide: Title.1Title.Single -->\n# 表紙\n## サブ").slides[0];
    expect(cover.layout).toBe("Title.1Title.Single"); // pinned, absent from this template
    const resolved = autoSelectLayout(cover, 0, 3, cat);
    const layout = findLayout(report, resolved);
    expect(layout).toBeDefined();
    expect(layout!.background).toBe("0A5A87"); // dark cover panel renders, not white
  });

  it("inherits placeholder geometry from the master when a layout placeholder omits its xfrm", () => {
    // The cover's date/footer/slideNumber placeholders carry NO own <a:off>/<a:ext> (they inherit
    // from the master's footer band). Without inheritance they collapsed to 0×0 = invisible.
    const cover = report.layouts.find((l) => l.name === "00_表紙")!;
    const footerRow = cover.placeholders.filter((p) => ["dt", "ftr", "sldNum"].includes(p.type));
    expect(footerRow.length).toBeGreaterThanOrEqual(2);
    for (const p of footerRow) {
      expect(p.style.w).toBeGreaterThan(0);
      expect(p.style.h).toBeGreaterThan(0);
      expect(p.style.y).toBeGreaterThan(5); // down in the footer band, not at the top-left origin
      // …and the master placeholder's own SMALL font (12pt), not the generic 32pt body font that
      // would overflow the 0.4" footer box and get clipped.
      expect(p.style.fontSize).toBeLessThan(20);
    }
  });

  it("keeps ONLY real solid-filled panels on the canonical master (no text-box ghosts)", () => {
    // 29 real spPr-solidFill panels; the 68 noFill text boxes must be dropped (were ghosted before).
    const total = canon.layouts.reduce((n, l) => n + l.decorations.length, 0);
    expect(total).toBe(29);
    // the signature navy panel color is still present.
    expect(canon.layouts.some((l) => l.decorations.some((d) => d.color === "1E2761"))).toBe(true);
  });
});
