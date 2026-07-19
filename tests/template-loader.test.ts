/**
 * template-loader.test.ts — Tests for template PPTX loading and layout registry.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import {
  loadTemplate,
  type TemplateData,
} from "../src/engine/template-loader";
import { autoSelectLayout } from "../src/engine/template-loader";
import type { SlideIR } from "../src/engine/slide-schema";

const TEMPLATE_PATH = resolve(
  __dirname,
  "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx",
);

let tpl: TemplateData;

beforeAll(async () => {
  const buf = readFileSync(TEMPLATE_PATH);
  tpl = await loadTemplate(buf);
});

describe("loadTemplate", () => {
  it("loads 31 layouts", () => {
    expect(tpl.layouts).toHaveLength(31); // 30 canonical + SectionNav.1TitleList.Single (#167)
  });

  it("each layout has a name and index", () => {
    for (const layout of tpl.layouts) {
      expect(layout.name).toBeTruthy();
      expect(layout.index).toBeGreaterThanOrEqual(1);
      expect(layout.index).toBeLessThanOrEqual(31);
    }
  });

  it("each layout has placeholder info", () => {
    // Layout 7 (Content.1Body.Single) should have placeholders 15, 16, 1, 50
    const l7 = tpl.layouts.find((l) => l.index === 7);
    expect(l7).toBeDefined();
    const idxs = l7!.placeholders.map((p) => p.idx);
    expect(idxs).toContain("15");
    expect(idxs).toContain("16");
    expect(idxs).toContain("1");
  });

  it("layout 1 has ctrTitle placeholder (idx 0)", () => {
    const l1 = tpl.layouts.find((l) => l.index === 1);
    expect(l1).toBeDefined();
    const idxs = l1!.placeholders.map((p) => p.idx);
    expect(idxs).toContain("0");
  });

  it("body placeholder inherits the master bullet (this template = none)", () => {
    const l7 = tpl.layouts.find((l) => l.index === 7)!; // Content.1Body.Single
    const body = l7.placeholders.find((p) => p.idx === "1")!;
    // Master uses buNone → no bullet glyph; we must follow that, not force "▸".
    expect(body.style.bulletChar).toBe("");
  });

  it("placeholder shapes contain XML", () => {
    const l7 = tpl.layouts.find((l) => l.index === 7);
    const ph15 = l7!.placeholders.find((p) => p.idx === "15");
    expect(ph15).toBeDefined();
    expect(ph15!.shapeXml).toContain("<p:");
    expect(ph15!.shapeXml.length).toBeGreaterThan(50);
  });

  it("finds layout by name", () => {
    const layout = tpl.layouts.find(
      (l) => l.name === "Content.1Body.Single",
    );
    expect(layout).toBeDefined();
    expect(layout!.index).toBe(7);
  });

  it("preserves presentation.xml and rels for PPTX assembly", () => {
    expect(tpl.presentationXml).toContain("p:presentation");
    expect(tpl.presentationRels).toContain("Relationship");
    expect(tpl.contentTypes).toContain("Types");
  });
});

describe("autoSelectLayout", () => {
  function makeSlide(overrides: Partial<SlideIR>): SlideIR {
    return {
      layout: "auto",
      placeholders: [],
      ...overrides,
    };
  }

  it("selects Title for first slide", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "Title" }] }] },
      ],
    });
    const name = autoSelectLayout(slide, 0, 1);
    expect(name).toMatch(/^Title\./);
  });

  it("selects Section for heading-only slide", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "Section" }] }] },
      ],
    });
    const name = autoSelectLayout(slide, 1, 5);
    expect(name).toMatch(/^Section\./);
  });

  it("an image (like table/code) counts as body → a content layout, not a title, even at index 0", () => {
    const slide = makeSlide({
      placeholders: [{ idx: "15", paragraphs: [{ segments: [{ text: "画像" }] }] }],
      image: { src: "data:image/png;base64,AAAA", alt: "", placeholderIdx: "1" },
    });
    expect(autoSelectLayout(slide, 0, 3)).not.toMatch(/^Title\./); // a figure slide isn't forced to a cover
    expect(autoSelectLayout(slide, 1, 3)).toMatch(/Content|Body/i); // routes to a body-bearing layout
  });

  it("selects Content for heading + body", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "Title" }] }] },
        { idx: "1", paragraphs: [{ segments: [{ text: "Body" }] }] },
      ],
    });
    const name = autoSelectLayout(slide, 1, 5);
    expect(name).toMatch(/^Content\./);
  });

  it("selects Column.2Body for 2 content sections", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "Title" }] }] },
        { idx: "1", paragraphs: [{ segments: [{ text: "Left" }] }] },
        { idx: "2", paragraphs: [{ segments: [{ text: "Right" }] }] },
      ],
    });
    const name = autoSelectLayout(slide, 1, 5);
    expect(name).toMatch(/Column\.2Body/);
  });

  it("selects Column.3Body for 3 content sections", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "Title" }] }] },
        { idx: "1", paragraphs: [{ segments: [{ text: "A" }] }] },
        { idx: "2", paragraphs: [{ segments: [{ text: "B" }] }] },
        { idx: "3", paragraphs: [{ segments: [{ text: "C" }] }] },
      ],
    });
    const name = autoSelectLayout(slide, 1, 5);
    expect(name).toMatch(/Column\.3Body/);
  });

  it("selects Closing for last slide with thank keyword", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "0", paragraphs: [{ segments: [{ text: "Thank you" }] }] },
      ],
    });
    const name = autoSelectLayout(slide, 4, 5);
    expect(name).toMatch(/^Closing\./);
  });

  it("returns explicit layout when not auto", () => {
    const slide = makeSlide({ layout: "KPI.3Value.Equal" });
    const name = autoSelectLayout(slide, 0, 1);
    expect(name).toBe("KPI.3Value.Equal");
  });

  it("selects a Content layout (idx 1) for a title+diagram slide, not Section", () => {
    // A diagram occupies placeholder idx 1 even though it isn't in `placeholders`;
    // without this the slide picked Section (no idx 1) and the diagram never rendered.
    const slide = makeSlide({
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "System" }] }] },
        { idx: "16", paragraphs: [{ segments: [{ text: "Architecture" }] }] },
      ],
      diagram: { yaml: "type: flowchart\nnodes: []", placeholderIdx: "1" },
    });
    expect(autoSelectLayout(slide, 1, 5)).toMatch(/^Content\./);
  });

  it("selects a Content layout (idx 1) for a title+mermaid slide", () => {
    const slide = makeSlide({
      placeholders: [
        { idx: "15", paragraphs: [{ segments: [{ text: "Flow" }] }] },
      ],
      mermaidBlock: { mermaid: "graph TD\n A-->B", placeholderIdx: "1" },
    });
    expect(autoSelectLayout(slide, 1, 5)).toMatch(/^Content\./);
  });
});

// #192 / #115-a: <a:ea> (East-Asian typeface) extraction, wired through to PlaceholderStyle so the
// CJK fallback stack (font-stack.ts) knows the template's declared JP brand font.
describe("<a:ea> (East-Asian typeface) extraction", () => {
  it("a real corporate template's layout placeholder carries its declared ea typeface", async () => {
    const corp = await loadTemplate(
      readFileSync(resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx")),
    );
    const l1 = corp.layouts.find((l) => l.index === 1)!; // Title.1Title.Single
    // idx 14 ("メタ情報（日付・部署・作成者）") declares <a:latin typeface="Yu Gothic"/>
    // <a:ea typeface="Yu Gothic"/> explicitly in its lstStyle lvl1 defRPr.
    const meta = l1.placeholders.find((p) => p.idx === "14")!;
    expect(meta.style.eaFontName).toBe("Yu Gothic");
  });

  it("never leaks an unresolved theme reference (+mj-ea/+mn-ea) as a literal ea font name", async () => {
    // This template's <p:titleStyle>/<p:bodyStyle> declare <a:ea typeface="+mj-ea"/>/"+mn-ea"
    // (PowerPoint's own default authoring convention) — unlike <a:latin> (an existing, separately
    // tested raw-token contract — see master-remake.test.ts "theme-font token resolution"),
    // eaFontName is a NEW field feeding straight into cjkFontFamily's font-family CSS, so it must
    // never surface the raw "+mj-ea"/"+mn-ea" token.
    const corp = await loadTemplate(
      readFileSync(resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx")),
    );
    expect(corp.masterTitleStyle.eaFontName?.startsWith("+")).not.toBe(true);
    expect(corp.masterBodyStyle.eaFontName?.startsWith("+")).not.toBe(true);
  });
});

// #103: per-level (1-3) font sizes for nested bullets, extracted for the SSR preview only (the
// PPTX export never pins these — PowerPoint inherits lvl1-4 from the master natively, R7).
describe("nested-bullet levelFontSizes (#103)", () => {
  it("this fixture's master defines no lvl2-4 body style → a decreasing step-down fallback", async () => {
    // Confirmed via the fixture's raw bodyStyle: only <a:lvl1pPr> is present.
    const l7 = tpl.layouts.find((l) => l.index === 7)!; // Content.1Body.Single
    const body = l7.placeholders.find((p) => p.idx === "1")!;
    const sizes = body.style.levelFontSizes;
    expect(sizes).toBeDefined();
    expect(sizes).toHaveLength(3);
    expect(sizes![0]).toBeLessThan(body.style.fontSize);
    expect(sizes![1]).toBeLessThan(sizes![0]!);
    expect(sizes![2]).toBeLessThan(sizes![1]!);
  });

  it("an explicit master lvl2pPr size WINS over the step-down fallback", async () => {
    const buf = readFileSync(TEMPLATE_PATH);
    const zip = await JSZip.loadAsync(buf);
    const masterPath = "ppt/slideMasters/slideMaster1.xml";
    const masterXml = await zip.file(masterPath)!.async("string");
    // This fixture's bodyStyle has only <a:lvl1pPr>…</a:lvl1pPr> — inject an explicit lvl2pPr
    // sized well outside the fallback's plausible range (fallback ≈ 14*0.88 ≈ 12.3pt) so a pass
    // means the master value was actually read, not coincidentally matched.
    const patched = masterXml.replace(
      "</a:lvl1pPr></p:bodyStyle>",
      '</a:lvl1pPr><a:lvl2pPr><a:defRPr sz="900"/></a:lvl2pPr></p:bodyStyle>',
    );
    expect(patched).not.toBe(masterXml); // sanity: the replace actually matched
    zip.file(masterPath, patched);
    const patchedBuf = await zip.generateAsync({ type: "uint8array" });

    const patchedTpl = await loadTemplate(patchedBuf);
    const l7 = patchedTpl.layouts.find((l) => l.index === 7)!;
    const body = l7.placeholders.find((p) => p.idx === "1")!;
    expect(body.style.levelFontSizes![0]).toBe(9); // sz="900" → 9pt, not the fallback's ~12.3pt
  });
});
