/**
 * ordered-list.test.ts — #394 numbered lists (`1.` / `1)`). Written before the wiring (R3).
 *
 * `N.` / `N)` lines are ORDERED bullets (`bullet: true, ordered: true`, nesting via the #103 2-space
 * rule), exported as `<a:buAutoNum type="arabicPeriod"/>` and serialized back as renumbered `1.` `2.`
 * (the number itself is not in the IR — PowerPoint numbers the items). `-`/`*` bullets and plain text
 * must stay byte-identical (IR, OOXML, Markdown).
 */
import { describe, it, expect } from "vitest";
import { matchListItem, orderedNumbers, listItemLine } from "../src/engine/list-markers";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { serializeParagraphs } from "../src/engine/md-serializer-shared";
import { paragraphToOoxml, paragraphsToOoxml } from "../src/engine/md-to-ooxml";
import { paragraphsToText, textToParagraphs } from "../src/engine/field-text";
import type { Paragraph } from "../src/engine/slide-schema";

const body = (md: string): Paragraph[] =>
  parseMd(md).slides[0].placeholders.find((p) => p.idx === "1")?.paragraphs ?? [];
const p = (text: string, extra: Partial<Paragraph> = {}): Paragraph => ({ segments: [{ text }], ...extra });
const ol = (text: string, level = 0): Paragraph =>
  p(text, { bullet: true, ordered: true, ...(level > 0 ? { level } : {}) });

describe("#394 list-markers: matchListItem", () => {
  it("`N.` / `N)` → ordered; `-` / `*` → unordered", () => {
    expect(matchListItem("1. 一")).toEqual({ ordered: true, content: "一" });
    expect(matchListItem("12) 十二")).toEqual({ ordered: true, content: "十二" });
    expect(matchListItem("- x")).toEqual({ ordered: false, content: "x" });
    expect(matchListItem("* x")).toEqual({ ordered: false, content: "x" });
  });

  it("a number without a following space, or >9 digits, is not a list marker (CommonMark)", () => {
    expect(matchListItem("1.5 倍")).toBeNull();
    expect(matchListItem("2026.10.05")).toBeNull();
    expect(matchListItem("1234567890. x")).toBeNull();
    expect(matchListItem("1.")).toBeNull();
  });
});

describe("#394 list-markers: orderedNumbers (serializer renumbering)", () => {
  it("consecutive ordered items count 1, 2, 3; non-ordered paragraphs get 0", () => {
    expect(orderedNumbers([ol("a"), ol("b"), ol("c")])).toEqual([1, 2, 3]);
    expect(orderedNumbers([p("x"), p("y", { bullet: true })])).toEqual([0, 0]);
  });

  it("deeper items do not interrupt the outer count; each nested run restarts at 1", () => {
    expect(orderedNumbers([ol("a"), ol("a1", 1), ol("a2", 1), ol("b"), ol("b1", 1)])).toEqual([1, 1, 2, 2, 1]);
    expect(orderedNumbers([ol("a"), p("u", { bullet: true, level: 1 }), ol("b")])).toEqual([1, 0, 2]);
  });

  it("a same-level `-` bullet, a plain line or a heading restarts the count", () => {
    expect(orderedNumbers([ol("a"), p("u", { bullet: true }), ol("b")])).toEqual([1, 0, 1]);
    expect(orderedNumbers([ol("a"), p("text"), ol("b")])).toEqual([1, 0, 1]);
    expect(orderedNumbers([ol("a"), p("H", { heading: true }), ol("b")])).toEqual([1, 0, 1]);
  });

  it("a blank paragraph does not break the list (CommonMark loose list)", () => {
    expect(orderedNumbers([ol("a"), p(""), ol("b")])).toEqual([1, 0, 2]);
  });

  it("listItemLine writes the indent + marker (the one writer shared by serializer and editor)", () => {
    expect(listItemLine(ol("a"), 3, "a")).toBe("3. a");
    expect(listItemLine(ol("a", 2), 1, "a")).toBe("    1. a");
    expect(listItemLine(p("a", { bullet: true, level: 1 }), 0, "a")).toBe("  - a");
  });
});

describe("#394 parser: `1.` is an ordered bullet", () => {
  it("`1. 一\\n2. 二` → two ordered bullets (markers stripped)", () => {
    expect(body("# T\n\n1. 一\n2. 二")).toEqual([ol("一"), ol("二")]);
  });

  it("`  1.` nests to level 1 (#103 2-space rule) and 8+ spaces clamp to 3", () => {
    expect(body("# T\n\n1. 親\n  1. 子\n        1. 深")).toEqual([ol("親"), ol("子", 1), ol("深", 3)]);
  });

  it("`1)` is ordered too; inline markup inside the item still parses", () => {
    expect(body("# T\n\n1) **太字**")).toEqual([
      { segments: [{ text: "太字", bold: true }], bullet: true, ordered: true },
    ]);
  });

  it("`-` / `*` bullets and plain text carry no `ordered` key (IR byte-identical)", () => {
    expect(body("# T\n\n- a\n* b\n  - c\n地の文\n1.5 倍")).toEqual([
      p("a", { bullet: true }),
      p("b", { bullet: true }),
      p("c", { bullet: true, level: 1 }),
      p("地の文"),
      p("1.5 倍"),
    ]);
  });

  it("works inside a group cell (column) as well", () => {
    const slide = parseMd("# T\n\n<!-- col -->\n1. 左\n<!-- col -->\n- 右").slides[0];
    expect(slide.placeholders.find((x) => x.idx === "1")?.paragraphs).toEqual([ol("左")]);
    expect(slide.placeholders.find((x) => x.idx === "2")?.paragraphs).toEqual([p("右", { bullet: true })]);
  });
});

describe("#394 md-to-ooxml: ordered → buAutoNum", () => {
  it("ordered paragraphs get buAutoNum arabicPeriod and never buNone", () => {
    const xml = paragraphsToOoxml(body("# T\n\n1. 一\n2. 二"));
    expect(xml.match(/<a:buAutoNum type="arabicPeriod"\/>/g)).toHaveLength(2);
    expect(xml).not.toContain("buNone");
  });

  it("exact pPr: level 0 has no lvl, nested carries lvl; bullet font follows the text", () => {
    expect(paragraphToOoxml(ol("一"))).toBe(
      '<a:p><a:pPr><a:buFontTx/><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>一</a:t></a:r></a:p>',
    );
    expect(paragraphToOoxml(ol("子", 1))).toBe(
      '<a:p><a:pPr lvl="1"><a:buFontTx/><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>子</a:t></a:r></a:p>',
    );
  });

  it("`-` bullets and plain text are byte-identical to the pre-#394 output", () => {
    expect(paragraphToOoxml(p("a", { bullet: true }))).toBe("<a:p><a:r><a:t>a</a:t></a:r></a:p>");
    expect(paragraphToOoxml(p("a", { bullet: true, level: 2 }))).toBe('<a:p><a:pPr lvl="2"/><a:r><a:t>a</a:t></a:r></a:p>');
    expect(paragraphToOoxml(p("a"))).toBe("<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>a</a:t></a:r></a:p>");
  });
});

describe("#394 serializer: ordered items are renumbered `1.` `2.` …", () => {
  it("arbitrary source numbers / `)` normalize to a 1-based `N.` run", () => {
    expect(serializeParagraphs(body("# T\n\n3. a\n7) b\n9. c"))).toBe("1. a\n2. b\n3. c");
  });

  it("nesting and mixed markers round-trip in the canonical form", () => {
    const md = "# T\n\n1. a\n  1. a1\n  - u\n  2. a2\n2. b\n\n3. c\n- x\n1. d";
    expect(serializeParagraphs(body(md))).toBe("1. a\n  1. a1\n  - u\n  1. a2\n2. b\n\n3. c\n- x\n1. d");
  });

  it("round-trip: parse ∘ serialize is a fixpoint after normalization (IR and text)", () => {
    const md = "# T\n\n5. a\n   2) a1\n4. b\n\n<!-- note -->\n2. note item";
    const once = serializeMd(parseMd(md));
    expect(once).toContain("1. a\n  1. a1\n2. b");
    expect(once).toContain("<!-- note -->\n1. note item");
    // IR is unchanged by the normalization (numbers are not in the IR) …
    expect(body(once)).toEqual(body(md));
    expect(parseMd(once).slides[0].notes).toEqual(parseMd(md).slides[0].notes);
    // … and the normalized text is a fixpoint.
    expect(serializeMd(parseMd(once))).toBe(once);
  });
});

describe("#394 GUI field editor text (field-text): numbering survives an edit round-trip", () => {
  it("ordered items show as renumbered `N.` lines and parse back as ordered", () => {
    const paras = [ol("a"), ol("a1", 1), ol("b"), p("u", { bullet: true }), p("地の文")];
    const text = paragraphsToText(paras);
    expect(text).toBe("1. a\n  1. a1\n2. b\n- u\n地の文");
    expect(textToParagraphs(text)).toEqual(paras);
  });

  it("`-` / `*` / plain lines parse exactly as before (no `ordered` key)", () => {
    expect(textToParagraphs("- a\n  * b\n- \nx")).toEqual([
      p("a", { bullet: true }),
      p("b", { bullet: true, level: 1 }),
      p("", { bullet: true }),
      p("x"),
    ]);
  });

  it("the field editor and the Markdown serializer write identical list lines (agreement, R8)", () => {
    const paras = body("# T\n\n4. a\n  9) a1\n  - u\n5. b\n\n6. c\n- x");
    expect(paragraphsToText(paras)).toBe(serializeParagraphs(paras));
  });
});
