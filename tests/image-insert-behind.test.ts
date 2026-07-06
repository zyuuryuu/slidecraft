/**
 * image-insert-behind.test.ts — the insert default (slideHasContent): a slide that already has body
 * text / a figure must route a pasted image to a BACKMOST layer (最背面) so existing content is NOT
 * destroyed; only a truly empty slide takes the image as a body figure. Guards the user-reported
 * "既存コンテンツが消し飛ぶ" regression at the decision boundary.
 */
import { describe, it, expect } from "vitest";
import { parseMd } from "../src/engine/md-parser";
import { slideHasContent, blankSlide } from "../src/engine/deck-structure";
import type { SlideIR } from "../src/engine/slide-schema";

const agenda = (): SlideIR =>
  parseMd("# 本日のアジェンダ\n\n> Today's Agenda\n\n- プロジェクト概要と目的\n- 現状分析データの共有\n- システム比較と推奨案").slides[0];

describe("insert default → 最背面 when the slide has content", () => {
  it("a title+subtitle+bullets slide HAS content (→ behind, non-destructive)", () => {
    expect(slideHasContent(agenda())).toBe(true);
  });

  it("a title-only cover HAS content (→ behind)", () => {
    expect(slideHasContent(parseMd("# タイトルだけ").slides[0])).toBe(true);
  });

  it("a diagram-only slide HAS content (→ behind, the diagram survives)", () => {
    expect(slideHasContent(parseMd("# 図\n\n```diagram\nnodes:\n  - id: a\n    label: A\n```").slides[0])).toBe(true);
  });

  it("a blank slide has NO content (→ body figure occupies the frame)", () => {
    expect(slideHasContent(blankSlide())).toBe(false);
  });

  it("a slide whose only placeholder is empty/whitespace has NO content", () => {
    const s: SlideIR = { layout: "auto", placeholders: [{ idx: "1", paragraphs: [{ segments: [{ text: "   " }] }] }] };
    expect(slideHasContent(s)).toBe(false);
  });
});
