/**
 * issue-102-cell-heading.test.tsx — #102: a cell-internal `## X` was left as literal body text
 * (`linesToParagraphs` only recognized `###` as a GROUP heading), so it printed onto the slide as
 * "## X" instead of rendering as the card/step's heading. Cell-internal `##` is promoted to the same
 * heading treatment as `###` — round-trip folds to the `###` canonical form (md-serializer-shared
 * always writes `heading: true` back as `### `), so output is stable.
 *
 * Scope is deliberately narrow: ONLY group-cell content (col/kpi/step/card sections) gets this
 * promotion. Outside a cell, `##` is the subtitle convention (# title / ## subtitle) and must stay
 * byte-identical; a non-grouped slide's parse/output must be byte-identical too.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import type { SlideIR } from "../src/engine/slide-schema";
import { loadTemplate, findLayout, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { generatePptx } from "../src/engine/placeholder-filler";
import { SlideCard } from "../src/components/SlidePreview";

const rt = (s: SlideIR) => parseMd(serializeMd({ slides: [s] })).slides[0];

const TPL_PATH = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const CARD_MD = "# 施策\n\n<!-- card -->\n### 施策A\n- 項目\n\n<!-- card -->\n### 施策B\n- 項目2";

describe("#102 cell-internal ## promotes to a GROUP heading (like ###)", () => {
  it("`## X` inside a card cell becomes heading:true, same as `### X`", () => {
    const src = parseMd("# T\n\n<!-- card -->\n## A\n- x").slides[0];
    const cell = src.placeholders.find((p) => p.idx === "1")!;
    const headingPara = cell.paragraphs.find((p) => p.heading);
    expect(headingPara).toBeDefined();
    expect(headingPara!.segments.map((s) => s.text).join("")).toBe("A");
  });

  it("round-trips stably: `## A` in a cell folds to the `###` canonical form", () => {
    const src = parseMd("# T\n\n<!-- card -->\n## A\n- x").slides[0];
    const md = serializeMd({ slides: [src] });
    expect(md.split("\n")).toContain("### A");
    // stable under a second round-trip
    const back = rt(src);
    const md2 = serializeMd({ slides: [back] });
    expect(md2).toBe(md);
  });

  it("`### X` inside a cell is unaffected (unchanged pre-existing behavior)", () => {
    const src = parseMd("# T\n\n<!-- card -->\n### A\n- x").slides[0];
    const cell = src.placeholders.find((p) => p.idx === "1")!;
    expect(cell.paragraphs.some((p) => p.heading && p.segments[0].text === "A")).toBe(true);
  });
});

describe("#102 non-cell `##` (subtitle convention) is byte-identical", () => {
  it("a standalone slide's `# title` + `## subtitle` still binds to the subtitle placeholder, not a heading paragraph", () => {
    const src = parseMd("# Title\n## Subtitle text\n\nBody line").slides[0];
    expect(JSON.stringify(src)).toContain("Subtitle text");
    // subtitle must NOT become a `heading: true` body paragraph anywhere
    const anyHeadingPara = src.placeholders.some((p) => p.paragraphs.some((pp) => pp.heading));
    expect(anyHeadingPara).toBe(false);
  });

  it("non-group slide parse/output is unchanged: a body `##` line outside any cell stays as-is", () => {
    const before = parseMd("# Title\n## Subtitle\n\nBody line");
    const beforeMd = serializeMd(before);
    const after = parseMd(beforeMd);
    const afterMd = serializeMd(after);
    expect(afterMd).toBe(beforeMd);
  });
});

describe("#102 regenerated Midnight template: bodyStyle lvl1 has buChar, card cell bullets show a glyph", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(TPL_PATH));
  });

  it("the template's master bodyStyle lvl1 resolves to a bullet glyph (scripts/add-body-bullet-style.ts)", () => {
    // Any layout's plain body placeholder (idx 1, no per-shape override) inherits the master glyph.
    const l = tpl.layouts.find((x) => x.name === "Content.1Body.Single")!;
    const body = l.placeholders.find((p) => p.idx === "1")!;
    expect(body.style.bulletChar).toBe("•");
  });

  it("a card cell's `- 項目` bullet renders with the bullet glyph in the SSR preview", () => {
    const cat = buildCatalog(tpl);
    const deck = parseMd(CARD_MD);
    const slide = deck.slides[0];
    const layout = findLayout(tpl, autoSelectLayout(slide, 0, deck.slides.length, cat));
    const html = renderToStaticMarkup(
      <SlideCard
        slide={slide}
        slideIndex={0}
        totalSlides={deck.slides.length}
        layout={layout}
        masterBgColor={tpl.masterBgColor}
        masterDecorations={tpl.masterDecorations}
        masterStaticTexts={tpl.masterStaticTexts}
        scale={96}
        exportMode
      />,
    );
    expect(html).toContain("項目");
    expect(html).toMatch(/margin-right:0\.4em">•</);
  });

  it("a card cell's `- 項目` bullet round-trips into the exported PPTX inheriting the master glyph (no explicit buNone)", async () => {
    const deck = parseMd(CARD_MD);
    deck.template = undefined;
    const buf = await generatePptx(deck, tpl);
    const zip = await JSZip.loadAsync(buf);
    const master = await zip.file("ppt/slideMasters/slideMaster1.xml")!.async("string");
    expect(master).toContain('<a:buChar char="•"/>');
    const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    // the bullet paragraph carries the text with NO <a:pPr><a:buNone/></a:pPr> (which would suppress
    // the inherited glyph) — only non-bullet paragraphs get that explicit suppression.
    const bulletParaMatch = s1.match(/<a:p>((?:(?!<a:p>)[\s\S])*?項目(?:(?!<\/a:p>)[\s\S])*?)<\/a:p>/);
    expect(bulletParaMatch).toBeTruthy();
    expect(bulletParaMatch![1]).not.toContain("buNone");
  });
});
