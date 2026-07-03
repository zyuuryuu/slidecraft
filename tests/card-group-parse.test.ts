/**
 * card-group-parse.test.ts — Slice A of the grouped-layout work: `<!-- card -->` / `<!-- step -->`
 * separators where each group is a `### 見出し` heading + body. The parser must:
 *  - split into one placeholder per group (idx 1,2,3…),
 *  - mark the `### …` line as a HEADING paragraph (first paragraph of the group),
 *  - record the separator kind on the slide (groupKind) as a layout-selection hint,
 *  - degrade cleanly (on a plain columns layout it's just a heading + body per column).
 */
import { describe, it, expect } from "vitest";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";

const CARD_MD = `# アーキテクチャ構成

<!-- card -->
### 収集層
eBPF で可視化

<!-- card -->
### 分析層
SIEM へ集約

<!-- card -->
### 運用
Sigma で管理`;

describe("card/step group parsing (Slice A)", () => {
  it("splits into one placeholder per card group at idx 1,2,3", () => {
    const s = parseMd(CARD_MD).slides[0];
    expect(s.placeholders.map((p) => p.idx)).toEqual(expect.arrayContaining(["1", "2", "3"]));
    expect(s.groupKind).toBe("card");
  });

  it("marks the ### line as a HEADING paragraph (first), body follows", () => {
    const s = parseMd(CARD_MD).slides[0];
    const g1 = s.placeholders.find((p) => p.idx === "1")!;
    expect(g1.paragraphs[0].heading).toBe(true);
    expect(g1.paragraphs[0].segments.map((x) => x.text).join("")).toBe("収集層");
    // the ### marker is stripped (not literal text)
    expect(g1.paragraphs[0].segments.map((x) => x.text).join("")).not.toContain("#");
    // body follows the heading
    const body = g1.paragraphs.slice(1).flatMap((p) => p.segments.map((x) => x.text)).join("");
    expect(body).toContain("eBPF で可視化");
  });

  it("round-trips through the serializer (card kind + ### headings survive)", () => {
    // Pin a columns layout so the serializer takes the content/columns path (a lone slide is index 0,
    // where autoSelect would otherwise force Title). In a real deck the card slide isn't index 0.
    const s = parseMd(CARD_MD).slides[0];
    const md = serializeMd({ slides: [{ ...s, layout: "Column.3Body.Equal" }] });
    const s2 = parseMd(md).slides[0];
    expect(s2.groupKind).toBe("card");
    expect(s2.placeholders.find((p) => p.idx === "2")!.paragraphs[0].heading).toBe(true);
    expect(s2.placeholders.find((p) => p.idx === "2")!.paragraphs[0].segments.map((x) => x.text).join("")).toBe("分析層");
  });

  it("step groups set groupKind=step", () => {
    const s = parseMd("# 進め方\n\n<!-- step -->\n### 要件定義\n基準を確定\n\n<!-- step -->\n### 環境構築\nPoC 環境").slides[0];
    expect(s.groupKind).toBe("step");
  });
});
