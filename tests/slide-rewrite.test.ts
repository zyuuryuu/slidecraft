/**
 * slide-rewrite.test.ts — deterministic per-issue fixes on a slide's Markdown span.
 */
import { describe, it, expect } from "vitest";
import { visualizeKeyValueMd } from "../src/engine/slide-rewrite";
import { parseMd } from "../src/engine/md-parser";

describe("visualizeKeyValueMd", () => {
  it("replaces a key-value bullet run with a table, keeping heading + spacing", () => {
    const span = "# 仕様\n\n- 速度: 0.8秒\n- 重量: 1.2kg\n- 料金: 1200円";
    const out = visualizeKeyValueMd(span);
    expect(out).toBe("# 仕様\n\n| 項目 | 内容 |\n| --- | --- |\n| 速度 | 0.8秒 |\n| 重量 | 1.2kg |\n| 料金 | 1200円 |");
    // and it parses into a native table on the slide
    const deck = parseMd(out!);
    expect(deck.slides[0].table?.rows[0]).toEqual(["項目", "内容"]);
  });

  it("returns null when the bullets are not key-value (nothing to convert)", () => {
    expect(visualizeKeyValueMd("# X\n\n- 速い\n- 安い")).toBeNull();
  });

  it("leaves a slide with no bullets untouched (null)", () => {
    expect(visualizeKeyValueMd("# Just a title")).toBeNull();
  });
});
