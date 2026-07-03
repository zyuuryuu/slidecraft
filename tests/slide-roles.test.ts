/**
 * slide-roles.test.ts — locks the CANONICAL placeholder-role convention (single source of truth) and,
 * crucially, that the AI reconcile guard restores a dropped title into the SAME idx the parser used.
 * This is the anti-drift test: if the format convention ever changes, parser ↔ reconcile must stay
 * in agreement here, so the AI structure guard can't silently desync from the parser.
 */
import { describe, it, expect } from "vitest";
import { isTitleLayout, isTitleNamespace, titleSubtitleIdx, META_IDXS, metaFieldIdx } from "../src/engine/slide-roles";
import { parseMd } from "../src/engine/md-parser";
import { reconcileEdit } from "../src/engine/ai-reconcile";

describe("slide-roles — canonical convention", () => {
  it("isTitleLayout matches the Title./Closing. families only", () => {
    expect(isTitleLayout("Title.1Title.Single")).toBe(true);
    expect(isTitleLayout("Closing.1Message.Single")).toBe(true);
    expect(isTitleLayout("Content.1Body.Single")).toBe(false);
    expect(isTitleLayout("auto")).toBe(false);
  });

  it("the title namespace also triggers on meta-field presence (mirrors the parser)", () => {
    expect(isTitleNamespace("auto", true)).toBe(true);
    expect(isTitleNamespace("Content.1Body.Single", false)).toBe(false);
    expect(titleSubtitleIdx("auto", true)).toEqual({ title: "0", subtitle: "1" });
    expect(titleSubtitleIdx("Content.1Body.Single", false)).toEqual({ title: "15", subtitle: "16" });
  });

  it("meta idx mapping is consistent", () => {
    expect(META_IDXS).toEqual(["10", "11", "12"]);
    expect(metaFieldIdx("Date")).toBe("11");
    expect(metaFieldIdx("footer")).toBe("12");
  });
});

describe("parser ↔ reconcile agree on the title idx (anti-drift)", () => {
  const titleIdx = (s: ReturnType<typeof parseMd>["slides"][0]) =>
    s.placeholders.find((p) => p.paragraphs.some((pp) => pp.segments.some((x) => x.text.includes("見出し") || x.text.includes("表紙"))))?.idx;

  it("content layout: parser uses idx15, reconcile restores idx15", () => {
    const old = parseMd("<!-- slide: Content.1Body.Single -->\n# 見出し\n\n- 本文").slides[0];
    expect(titleIdx(old)).toBe("15");
    const edited = parseMd("- 本文だけ").slides[0]; // header + title dropped
    const r = reconcileEdit(old, edited);
    expect(r.placeholders.find((p) => p.idx === "15")?.paragraphs[0].segments[0].text).toBe("見出し");
  });

  it("title layout (pinned): parser uses idx0, reconcile restores idx0", () => {
    const old = parseMd("<!-- slide: Title.1Title.Single -->\n# 表紙\n## サブ").slides[0];
    expect(titleIdx(old)).toBe("0");
    const edited = parseMd("## サブだけ").slides[0]; // header + title dropped
    const r = reconcileEdit(old, edited);
    expect(r.layout).toBe("Title.1Title.Single");
    expect(r.placeholders.find((p) => p.idx === "0")?.paragraphs[0].segments[0].text).toBe("表紙");
  });

  it("EDGE (the drift bug): auto layout + meta fields → parser idx0, reconcile restores idx0", () => {
    // No <!-- slide --> header, but a Category field promotes it to the title namespace (idx0).
    const old = parseMd("# 表紙\n\nCategory: 部門X").slides[0];
    expect(old.layout).toBe("auto");
    expect(titleIdx(old)).toBe("0"); // parser put the title at idx0
    // The edit drops the title but keeps the Category (still title-namespace).
    const edited = parseMd("Category: 部門X\n\n- 追記").slides[0];
    const r = reconcileEdit(old, edited);
    // Before the fix reconcile judged the namespace from the layout NAME only ("auto" → idx15) and
    // missed the idx0 title. After the fix it mirrors the parser (meta present → idx0) and restores it.
    expect(r.placeholders.find((p) => p.idx === "0")?.paragraphs[0].segments[0].text).toBe("表紙");
  });
});
