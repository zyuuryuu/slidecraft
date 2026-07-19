/**
 * issue-195-leading-section-cover.test.ts — #195: autoSelectLayout の先頭スライド→表紙
 * ヒューリスティック（template-loader.ts）が sectionBreak を見ておらず、先頭の title-only 章扉
 * （`<!-- section -->` + title-only）を表紙 Title 系に誤って解決していた。
 *
 * serializeSlide は解決レイアウトの名前空間で読むため、表紙（idx0/ctrTitle）に誤解決された章扉は
 * idx15 タイトルを emit できず、round-trip でタイトルが消える。fix はカバー分岐に sectionBreak
 * 除外ゲートを1つ足す（選出側の根治 — serializer 側で塞がない）。
 */
import { describe, it, expect } from "vitest";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { autoSelectLayout } from "../src/engine/template-loader";

describe("#195 — 先頭の title-only 章扉は表紙ではなく Section 系に解決される", () => {
  const MD = "<!-- section -->\n# A\n\n---\n\n\n# B\n";

  it("先頭章扉の resolvedLayout は Section 系（Title 系ではない）", () => {
    const deck = parseMd(MD);
    expect(deck.slides[0].sectionBreak).toBe(true);
    const resolved = autoSelectLayout(deck.slides[0], 0, deck.slides.length);
    expect(resolved).toMatch(/^Section/);
  });

  it("先頭章扉「# A」が round-trip で保存される", () => {
    const deck = parseMd(MD);
    const out = serializeMd(deck);
    expect(out).toContain("# A");
  });

  it("sectionBreak の無い先頭 title-only スライドは従来どおり Title（表紙）に解決される（byte-identical）", () => {
    const deck = parseMd("# 表紙\n\n---\n\n# 本文\n\n- 箇条書き\n");
    const resolved = autoSelectLayout(deck.slides[0], 0, deck.slides.length);
    expect(resolved).toBe("Title.1Title.Single");
  });
});
