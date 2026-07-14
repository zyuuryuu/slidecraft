/**
 * unclosed-fence.test.ts — #89: 未閉じの図/コードフェンスの no-silent-drop。
 * 未閉じ ```diagram/```mermaid/```code は EOF（スライド終端）で暗黙クローズ扱いにして復元する
 * （＝黙って捨てない）。閉じたフェンスは従来どおり（回帰なし）。
 * 現実の引き金は docs のネスト fence バグ（#88）＝コピーで閉じ ``` が消えた未閉じ ```diagram。
 */
import { describe, it, expect } from "vitest";
import { parseMd } from "../src/engine/md-parser";

describe("未閉じフェンスの no-silent-drop (#89)", () => {
  it("未閉じ ```diagram → 図として復元（drop しない）", () => {
    const md = ["# 売上推移", "", "```diagram", "type: barchart", "series:", "  - name: Q", "    data: [1,2,3,4]"].join("\n");
    const deck = parseMd(md);
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].diagram).toBeTruthy();
    expect(deck.slides[0].diagram?.yaml).toContain("barchart");
  });

  it("未閉じ ```mermaid → 図 or mermaidBlock として復元", () => {
    const md = ["# フロー", "", "```mermaid", "flowchart TD", "  A --> B"].join("\n");
    const s = parseMd(md).slides[0];
    expect(s.diagram || s.mermaidBlock).toBeTruthy();
  });

  it("未閉じ ```python → コードとして復元", () => {
    const md = ["# コード例", "", "```python", "print('hi')", "x = 1"].join("\n");
    const s = parseMd(md).slides[0];
    expect(s.code).toBeTruthy();
    expect(s.code?.content).toContain("print('hi')");
  });

  it("閉じたフェンスは従来どおり図＋後続本文を拾う（回帰なし）", () => {
    const md = ["# 図タイトル", "", "```diagram", "type: barchart", "```", "", "- 補足の箇条書き"].join("\n");
    const s = parseMd(md).slides[0];
    expect(s.diagram).toBeTruthy();
    // 閉じフェンス後の本文も従来どおり拾える
    expect(JSON.stringify(s.placeholders)).toContain("補足");
  });
});
