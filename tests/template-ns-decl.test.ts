/**
 * template-ns-decl.test.ts — Issue #416.
 *
 * The bundled Midnight Executive template has 19 layouts whose child elements carry a redundant
 * namespace declaration (`<a:solidFill xmlns:ns4="…drawingml…">`). `normalizeNs` dropped the
 * attribute but left the space before it (`<a:solidFill >`), so the exact-match tag regexes
 * downstream (`/<a:solidFill>/`, `/<a:prstGeom prst="/`) missed every fill and the layout's
 * decorations (full-bleed dark BG, panels, bars) never reached the preview — while the PPTX export,
 * which inherits the layout, painted them. A redundant xmlns declaration must not change what we read.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import { loadTemplate, findLayout, type TemplateData } from "../src/engine/template-loader";

const MIDNIGHT = [
  resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx"),
  resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"),
];

const NS_DECL = /\sxmlns:ns\d+="[^"]*"/g;

/** The same package with every `xmlns:nsN` declaration textually removed from the layouts — an
 *  XML-equivalent document (the declarations bind prefixes nothing uses), so extraction must agree. */
async function withoutNsDecls(buf: Buffer): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(buf);
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slideLayouts\/[^/]+\.xml$/.test(n))) {
    zip.file(name, (await zip.file(name)!.async("string")).replace(NS_DECL, ""));
  }
  return zip.generateAsync({ type: "uint8array" });
}

/** Layout names whose XML carries at least one `xmlns:nsN` declaration. */
async function nsDeclaredLayouts(buf: Buffer, tpl: TemplateData): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const out: string[] = [];
  for (const l of tpl.layouts) {
    const xml = await zip.file(`ppt/slideLayouts/slideLayout${l.index}.xml`)!.async("string");
    if (NS_DECL.test(xml)) out.push(l.name);
    NS_DECL.lastIndex = 0;
  }
  return out;
}

describe("redundant xmlns:nsN declarations do not hide layout shapes (#416)", () => {
  for (const path of MIDNIGHT) {
    const label = path.includes("public") ? "shipped" : "fixture";

    it(`${label}: Closing.1Steps.Single+1Notes keeps its full-bleed 1E2761 background panel`, async () => {
      const tpl = await loadTemplate(readFileSync(path));
      const decos = findLayout(tpl, "Closing.1Steps.Single+1Notes")!.decorations;
      const bg = decos.find((d) => d.color === "1E2761" && d.x === 0 && d.y === 0);
      expect(bg).toBeDefined();
      expect(bg!.w).toBeCloseTo(13.33, 2);
      expect(bg!.h).toBeCloseTo(7.5, 2);
    });

    it(`${label}: all 19 namespace-declaring layouts have decorations`, async () => {
      const buf = readFileSync(path);
      const tpl = await loadTemplate(buf);
      const nsLayouts = await nsDeclaredLayouts(buf, tpl);
      expect(nsLayouts).toHaveLength(19);
      const empty = nsLayouts.filter((n) => findLayout(tpl, n)!.decorations.length === 0);
      expect(empty).toEqual([]);
    });

    it(`${label}: extraction equals the same template with the declarations removed`, async () => {
      const buf = readFileSync(path);
      const [withDecls, stripped] = await Promise.all([loadTemplate(buf), loadTemplate(await withoutNsDecls(buf))]);
      expect(withDecls.layouts).toEqual(stripped.layouts);
    });
  }
});
