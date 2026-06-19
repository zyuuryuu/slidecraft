/**
 * distill.test.ts — Split overflowing content to fit the template (no shrink).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  paragraphLines,
  packParagraphs,
  splitSlideToFit,
  contentBodyBox,
  distillDeck,
  type FitBox,
} from "../src/engine/distill";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import type { SlideIR, Paragraph } from "../src/engine/slide-schema";

const bullet = (text: string): Paragraph => ({ segments: [{ text }], bullet: true });
const slide = (overrides: Partial<SlideIR>): SlideIR => ({ layout: "auto", placeholders: [], ...overrides });
const body = (paras: Paragraph[]) => ({ idx: "1", paragraphs: paras });
const title = (text: string) => ({ idx: "15", paragraphs: [{ segments: [{ text }] }] });

describe("paragraphLines", () => {
  it("is 1 for a short line and grows by wrap", () => {
    expect(paragraphLines(bullet("abc"), 10)).toBe(1);
    expect(paragraphLines(bullet("a".repeat(10)), 10)).toBe(1);
    expect(paragraphLines(bullet("a".repeat(11)), 10)).toBe(2);
    expect(paragraphLines(bullet("a".repeat(25)), 10)).toBe(3);
  });
  it("counts full-width chars by code point", () => {
    expect(paragraphLines(bullet("あいうえお"), 5)).toBe(1);
    expect(paragraphLines(bullet("あいうえおか"), 5)).toBe(2);
  });
});

describe("packParagraphs", () => {
  const box: FitBox = { charsPerLine: 100, maxLines: 3 }; // 3 single-line bullets per chunk

  it("keeps everything in one chunk when it fits", () => {
    const ps = [bullet("a"), bullet("b"), bullet("c")];
    expect(packParagraphs(ps, box)).toEqual([ps]);
  });

  it("splits into chunks of whole paragraphs, order preserved", () => {
    const ps = [bullet("a"), bullet("b"), bullet("c"), bullet("d"), bullet("e")];
    const chunks = packParagraphs(ps, box);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(3);
    expect(chunks[1]).toHaveLength(2);
    expect(chunks.flat()).toEqual(ps); // no loss, order kept
  });

  it("never splits a single oversized paragraph (own chunk)", () => {
    const big = bullet("x".repeat(500)); // needs 5 lines in a 3-line box
    const chunks = packParagraphs([bullet("a"), big, bullet("b")], { charsPerLine: 100, maxLines: 3 });
    expect(chunks.flat()).toEqual([bullet("a"), big, bullet("b")]);
    expect(chunks.some((c) => c.length === 1 && c[0] === big)).toBe(true);
  });

  it("is a no-op for a degenerate box", () => {
    const ps = [bullet("a"), bullet("b")];
    expect(packParagraphs(ps, { charsPerLine: 0, maxLines: 0 })).toEqual([ps]);
  });
});

describe("splitSlideToFit", () => {
  const box: FitBox = { charsPerLine: 100, maxLines: 2 };

  it("leaves a fitting slide untouched", () => {
    const s = slide({ placeholders: [title("T"), body([bullet("a"), bullet("b")])] });
    expect(splitSlideToFit(s, box)).toEqual([s]);
  });

  it("splits an overflowing body, repeating the title", () => {
    const s = slide({ placeholders: [title("T"), body([bullet("a"), bullet("b"), bullet("c")])] });
    const out = splitSlideToFit(s, box);
    expect(out).toHaveLength(2);
    const titleText = (sl: SlideIR) =>
      sl.placeholders.find((p) => p.idx === "15")!.paragraphs[0].segments.map((g) => g.text).join("");
    // first slide keeps the title; continuations get a provisional marker
    expect(titleText(out[0])).toBe("T");
    expect(titleText(out[1])).toContain("T");
    expect(titleText(out[1])).toContain("（続き）");
    // body distributed, nothing lost
    const b0 = out[0].placeholders.find((p) => p.idx === "1")!.paragraphs;
    const b1 = out[1].placeholders.find((p) => p.idx === "1")!.paragraphs;
    expect([...b0, ...b1].map((p) => p.segments[0].text)).toEqual(["a", "b", "c"]);
  });

  it("does not split diagram or column slides", () => {
    const diag = slide({ placeholders: [title("T")], diagram: { yaml: "type: flowchart\nnodes: []", placeholderIdx: "1" } });
    expect(splitSlideToFit(diag, box)).toEqual([diag]);
    const cols = slide({ placeholders: [title("T"), { idx: "1", paragraphs: [bullet("a"), bullet("b"), bullet("c")] }, { idx: "2", paragraphs: [bullet("x")] }] });
    expect(splitSlideToFit(cols, box)).toEqual([cols]); // 2 bodies → columns lever, not split
  });
});

describe("distillDeck (with the canonical template)", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(resolve(__dirname, "../public/templates/slide/Midnight_Executive_30_TemplateOnly.pptx")));
    catalog = buildCatalog(tpl);
  });

  it("exposes a real content body fit box", () => {
    const box = contentBodyBox(catalog)!;
    expect(box.charsPerLine).toBeGreaterThan(10);
    expect(box.maxLines).toBeGreaterThan(3);
  });

  it("leaves a normal small deck unchanged (no spurious splits)", () => {
    const deck = { slides: [slide({ placeholders: [title("T"), body([bullet("短い項目"), bullet("もう一つ")])] })] };
    expect(distillDeck(deck, catalog).slides).toHaveLength(1);
  });

  it("splits a genuinely overstuffed content slide into multiple", () => {
    const many = Array.from({ length: 60 }, (_, i) => bullet(`これは比較的長めの箇条書き項目その${i + 1}番目です`));
    const deck = { slides: [slide({ placeholders: [title("詰め込みすぎ"), body(many)] })] };
    const out = distillDeck(deck, catalog).slides;
    expect(out.length).toBeGreaterThan(1);
    // nothing lost across the split
    const all = out.flatMap((s) => s.placeholders.find((p) => p.idx === "1")!.paragraphs);
    expect(all).toHaveLength(60);
  });
});
