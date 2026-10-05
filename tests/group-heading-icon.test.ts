/**
 * group-heading-icon.test.ts — #400: a group-cell heading `### :server: 可用性` shows a built-in
 * ICON_CATALOG icon left of the heading text (the `:server:` token itself is not printed).
 *
 * Representation: the token stays IN the heading text (IR unchanged) and is resolved at render time by
 * ONE function (splitHeadingIcon) that both the content fill (expandGroups strips the token) and the
 * overlay (groupCellOverlay places the icon) go through — so round-trip is stable by construction and
 * the GUI group field (which edits the cell's markdown text) never drops it. The icon is painted by the
 * diagram painter's paintIcon via the shared DrawTarget backends (R8: no second icon renderer).
 *
 * Invariants: an unknown name (`:nosuch:`) stays literal text (no-silent-drop); the token is only
 * recognized at the start of a PLAIN first segment, so it never collides with parseInline's tokens
 * (` [ ~ *); decks without the token are byte-identical (empty overlay).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData, type LayoutInfo } from "../src/engine/template-loader";
import { expandGroups, groupCellOverlay, detectGroups } from "../src/engine/group-binding";
import { splitHeadingIcon, headingIconGeometry, isEmptyOverlay } from "../src/engine/group-overlay";
import { parseInline } from "../src/engine/md-inline";
import { ICON_NAMES } from "../src/engine/icon-catalog";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { generatePptx } from "../src/engine/placeholder-filler";
import type { Paragraph, SlideIR } from "../src/engine/slide-schema";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideCard } from "../src/components/SlidePreview";

const DIR = resolve(__dirname, "fixtures/templates");
const heading = (md: string): Paragraph => ({ heading: true, segments: parseInline(md) });
const txt = (p: { segments: { text: string }[] }) => p.segments.map((s) => s.text).join("");
const cellTxt = (c: { paragraphs: Paragraph[] } | undefined) => (c?.paragraphs ?? []).map(txt).join("\n");

describe("#400 splitHeadingIcon — the ONE heading-icon recognizer", () => {
  it("`:server: 可用性` → icon server, heading text without the token", () => {
    const r = splitHeadingIcon(heading(":server: 可用性"));
    expect(r?.icon).toBe("server");
    expect(txt(r!.paragraph)).toBe("可用性");
    expect(r!.paragraph.heading).toBe(true);
  });

  it("aliases and case resolve through normalizeIconName (same gate as diagram node icons)", () => {
    expect(splitHeadingIcon(heading(":db: データ"))?.icon).toBe("database");
    expect(splitHeadingIcon(heading(":Server: X"))?.icon).toBe("server");
    expect(splitHeadingIcon(heading(":load-balancer: 分散"))?.icon).toBe("load_balancer");
  });

  it("an unknown name is NOT an icon (stays literal text — no-silent-drop)", () => {
    expect(splitHeadingIcon(heading(":nosuch: 可用性"))).toBeNull();
  });

  it("the token must lead the heading", () => {
    expect(splitHeadingIcon(heading("可用性 :server:"))).toBeNull();
    expect(splitHeadingIcon(heading("10:30: 開始"))).toBeNull();
  });

  it("a heading that is only the token keeps a non-empty segment list (schema min 1)", () => {
    const r = splitHeadingIcon(heading(":server:"));
    expect(r?.icon).toBe("server");
    expect(r!.paragraph.segments.length).toBeGreaterThanOrEqual(1);
    expect(txt(r!.paragraph)).toBe("");
  });
});

describe("#400 no collision with parseInline tokens (` [ ~ *)", () => {
  it("formatting AFTER the token is preserved", () => {
    const bold = splitHeadingIcon(heading(":server: **可用性**"));
    expect(bold?.icon).toBe("server");
    expect(bold!.paragraph.segments).toEqual([{ text: "可用性", bold: true }]);

    const italic = splitHeadingIcon(heading(":server:*強調*"));
    expect(italic?.icon).toBe("server");
    expect(italic!.paragraph.segments).toEqual([{ text: "強調", italic: true }]);

    const code = splitHeadingIcon(heading(":server: `api` 層"));
    expect(code!.paragraph.segments).toEqual([{ text: "api", code: true }, { text: " 層" }]);

    const link = splitHeadingIcon(heading(":server: [詳細](https://example.com)"));
    expect(link!.paragraph.segments).toEqual([{ text: "詳細", href: "https://example.com" }]);

    const strike = splitHeadingIcon(heading(":server: ~~旧~~"));
    expect(strike!.paragraph.segments).toEqual([{ text: "旧", strike: true }]);
  });

  it("a token INSIDE an inline token is literal (never an icon)", () => {
    for (const md of ["**:server:** x", "*:server:* x", "`:server:` x", "[:server:](https://example.com)", "~~:server:~~ x"]) {
      expect(splitHeadingIcon(heading(md)), md).toBeNull();
    }
  });
});

describe("#400 group fill + overlay (report template card layout)", () => {
  let tpl: TemplateData;
  let card: LayoutInfo;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(resolve(DIR, "報告書テンプレート_全レイアウト見本.pptx")));
    card = tpl.layouts.find((l) => l.name === "10_カード3列")!;
  });
  const slideOf = (md: string): SlideIR => parseMd(md).slides[0];
  const CARD = "# 構成\n\n<!-- card -->\n### :server: 可用性\n冗長化\n\n<!-- card -->\n### :nosuch: 性能\n高速\n\n<!-- card -->\n### 運用\n監視";

  it("expandGroups strips a known token; an unknown token stays literal", () => {
    const shape = detectGroups(card)!;
    const out = expandGroups(slideOf(CARD), card);
    const head = (i: number) => out.get(shape.groups[i].find((s) => s.role === "heading")!.phIdx);
    expect(cellTxt(head(0))).toBe("可用性");
    expect(cellTxt(head(1))).toBe(":nosuch: 性能");
    expect(cellTxt(head(2))).toBe("運用");
  });

  it("groupCellOverlay places ONE icon at the left of card 1's heading box, colored like the heading text", () => {
    const shape = detectGroups(card)!;
    const headIdx = shape.groups[0].find((s) => s.role === "heading")!.phIdx;
    const ph = card.placeholders.find((p) => p.idx === headIdx)!;
    const ov = groupCellOverlay(slideOf(CARD), card);
    expect(ov.icons).toHaveLength(1);
    const icon = ov.icons[0];
    expect(icon.name).toBe("server");
    expect(icon.phIdx).toBe(headIdx);
    expect(icon.color).toBe(ph.style.fontColor);
    const g = headingIconGeometry(ph);
    expect({ x: icon.x, y: icon.y, s: icon.s }).toEqual(g.box);
    // inside the heading box, at its left edge
    expect(icon.x).toBeGreaterThanOrEqual(ph.style.x);
    expect(icon.y).toBeGreaterThanOrEqual(ph.style.y - 1e-9);
    expect(icon.y + icon.s).toBeLessThanOrEqual(ph.style.y + ph.style.h + 1e-9);
    expect(icon.s).toBeGreaterThan(0);
    // the heading text is indented past the icon (lIns grows by icon + gap)
    expect(ov.insets.get(headIdx)).toBe(g.lIns);
    expect(g.lIns).toBeGreaterThan(icon.x - ph.style.x + icon.s);
    expect([...ov.insets.keys()]).toEqual([headIdx]); // the unknown-token card gets no inset
    expect(ov.frames).toEqual([]);
  });

  it("agreement (R8): every overlay icon's cell has its token stripped, and only those", () => {
    const slide = slideOf(CARD);
    const out = expandGroups(slide, card);
    const ov = groupCellOverlay(slide, card);
    const iconPhs = new Set(ov.icons.map((i) => i.phIdx));
    for (const [phIdx, c] of out) {
      const t = cellTxt(c);
      if (iconPhs.has(phIdx)) expect(t.startsWith(":server:")).toBe(false);
    }
    expect(iconPhs.size).toBe(1);
  });

  it("a deck without the token has an EMPTY overlay (byte-identical path)", () => {
    const ov = groupCellOverlay(slideOf("# T\n\n<!-- card -->\n### 可用性\nA\n\n<!-- card -->\n### 性能\nB"), card);
    expect(isEmptyOverlay(ov)).toBe(true);
  });

  it("single-slot group (Midnight Summary.2Block): icon on the merged slot, token stripped", async () => {
    const mid = await loadTemplate(readFileSync(resolve(DIR, "Midnight_Executive_30_TemplateOnly.pptx")));
    const block = mid.layouts.find((l) => l.name === "Summary.2Block.Equal")!;
    const slide = slideOf("# T\n\n<!-- card -->\n### :cloud: 移行\n- 段階的\n\n<!-- card -->\n### 継続\n- 運用");
    const shape = detectGroups(block)!;
    const slot = shape.groups[0].find((s) => s.role === "heading")!.phIdx;
    expect(cellTxt(expandGroups(slide, block).get(slot))).toBe("移行\n段階的");
    const ov = groupCellOverlay(slide, block);
    expect(ov.icons.map((i) => [i.name, i.phIdx])).toEqual([["cloud", slot]]);
  });
});

describe("#400 export (PPTX) + round-trip", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(resolve(DIR, "報告書テンプレート_全レイアウト見本.pptx"))); });
  const MD = "# 表紙\n\n---\n\n# 構成\n\n<!-- card -->\n### :server: 可用性\n冗長化\n\n<!-- card -->\n### :nosuch: 性能\n高速\n\n<!-- card -->\n### 運用\n監視";
  const slide2 = async (md: string) => {
    const deck = parseMd(md);
    deck.template = undefined;
    const zip = await JSZip.loadAsync(await generatePptx(deck, tpl));
    return zip.file("ppt/slides/slide2.xml")!.async("string");
  };
  const spWith = (xml: string, needle: string) => (xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).find((sp) => sp.includes(needle)) ?? "";

  it("the heading shape carries the text without `:server:` and an indented lIns; icon shapes are added", async () => {
    const xml = await slide2(MD);
    const plain = await slide2(MD.replace(":server: ", ""));
    expect(xml).not.toContain(":server:");
    expect(xml).toContain(":nosuch: 性能"); // unknown → literal
    const head = spWith(xml, ">可用性<");
    expect(head).toMatch(/<a:bodyPr[^>]*\blIns="(\d+)"/);
    const lIns = Number(head.match(/<a:bodyPr[^>]*\blIns="(\d+)"/)![1]);
    expect(lIns).toBeGreaterThan(0);
    expect(spWith(plain, ">可用性<")).toMatch(/<a:bodyPr[^>]*\blIns="0"/); // template's own lIns untouched without icon
    // the icon is drawn as extra native shapes (grouped), so the slide has more shapes than without it
    const count = (x: string) => (x.match(/<p:sp>/g) || []).length;
    expect(count(xml)).toBeGreaterThan(count(plain));
    expect(xml).toContain("<p:grpSp>");
  });

  it("every shape id on the slide is unique (overlay ids renumbered)", async () => {
    const xml = await slide2(MD);
    const ids = [...xml.matchAll(/<p:cNvPr[^>]*\bid="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("round-trip: the markdown is byte-stable and the IR is unchanged", () => {
    const md = "# 構成\n\n<!-- card -->\n### :server: **可用性**\n冗長化\n\n<!-- card -->\n### :nosuch: 性能\n高速\n";
    const once = serializeMd(parseMd(md));
    const twice = serializeMd(parseMd(once));
    expect(twice).toBe(once);
    expect(once).toContain("### :server: **可用性**");
    expect(once).toContain("### :nosuch: 性能");
    expect(parseMd(once).slides[0].placeholders).toEqual(parseMd(md).slides[0].placeholders);
  });
});

describe("#400 preview (SlideCard) — same overlay as the export", () => {
  let tpl: TemplateData;
  let card: LayoutInfo;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(resolve(DIR, "報告書テンプレート_全レイアウト見本.pptx")));
    card = tpl.layouts.find((l) => l.name === "10_カード3列")!;
  });
  const render = (md: string) =>
    renderToStaticMarkup(createElement(SlideCard, { slide: parseMd(md).slides[0], slideIndex: 0, layout: card, scale: 60, isActive: false, selected: false, onClick: () => {} }));

  it("an icon card draws the icon SVG and pads the heading text by the export's inset", () => {
    const md = "# T\n\n<!-- card -->\n### :server: 可用性\nA\n\n<!-- card -->\n### 性能\nB";
    const html = render(md);
    const plain = render(md.replace(":server: ", ""));
    const svgCount = (h: string) => (h.match(/<svg/g) || []).length; // a layout's decorations may be SVG too
    expect(html).not.toContain(":server:");
    expect(svgCount(html)).toBe(svgCount(plain) + 1);
    const ov = groupCellOverlay(parseMd(md).slides[0], card);
    const inset = [...ov.insets.values()][0];
    expect(html).toContain(`padding-left:${inset * 60}px`);
  });

  it("a card without the token gets no padding", () => {
    const html = render("# T\n\n<!-- card -->\n### 可用性\nA\n\n<!-- card -->\n### 性能\nB");
    expect(html).not.toContain("padding-left");
  });
});

describe("#400/#401 drift gate — what the guides teach is what the engine does", () => {
  it("the AI prompt teaches both, and its example parses to an icon heading + currentSteps [2]", async () => {
    const { slideSystemPrompt } = await import("../src/engine/llm-prompts");
    const p = slideSystemPrompt();
    const ex = p.match(/## Group Cells[\s\S]*?```\n([\s\S]*?)```/)![1];
    const slide = parseMd(`# T\n\n${ex}`).slides[0];
    expect(slide.currentSteps).toEqual([2]);
    const heads = slide.placeholders.filter((c) => /^[1-9]$/.test(c.idx)).map((c) => c.paragraphs.find((q) => q.heading)!);
    expect(heads.map((h) => splitHeadingIcon(h)?.icon)).toEqual(["client", "server"]);
    for (const name of ICON_NAMES) expect(p).toContain(name);
  });

  it("the JA/EN authoring guides list exactly the ICON_CATALOG names", () => {
    for (const f of ["docs/guide/markdown-authoring.md", "docs/en/guide/markdown-authoring.md"]) {
      const doc = readFileSync(resolve(__dirname, "..", f), "utf8");
      const line = doc.split("\n").find((l) => /`router` `switch`/.test(l))!;
      expect(line, f).toBeTruthy();
      const listed = [...line.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((n) => n !== "db");
      expect(listed, f).toEqual(ICON_NAMES);
    }
  });
});
