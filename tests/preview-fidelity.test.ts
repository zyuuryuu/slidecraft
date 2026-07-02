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

  it("captures connector lines (<p:cxnSp>) as thin decorations", () => {
    const withLine = report.layouts.find((l) => l.decorations.some((d) => d.h < 0.05 && d.w > 5));
    expect(withLine).toBeDefined(); // e.g. the full-width title/footer rules
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

  it("keeps ONLY real solid-filled panels on the canonical master (no text-box ghosts)", () => {
    // 29 real spPr-solidFill panels; the 68 noFill text boxes must be dropped (were ghosted before).
    const total = canon.layouts.reduce((n, l) => n + l.decorations.length, 0);
    expect(total).toBe(29);
    // the signature navy panel color is still present.
    expect(canon.layouts.some((l) => l.decorations.some((d) => d.color === "1E2761"))).toBe(true);
  });
});
