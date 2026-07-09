/**
 * unbound-content.test.ts — F1 do-no-harm ②a: no-silent-drop プリミティブ
 * （master-intake.md §2 部品2）。bindContentByRole が黙って落とす content を unboundContent が
 * 正確に列挙すること（＝「全 content は束縛 or 報告」の不変条件の基盤）。routing は不変。
 */
import { describe, it, expect } from "vitest";
import { unboundContent, bindContentByRole } from "../src/engine/placeholder-binding";
import type { PlaceholderInfo } from "../src/engine/template-loader";
import type { SlideIR } from "../src/engine/slide-schema";

const ph = (type: string, idx: string): PlaceholderInfo =>
  ({ idx, type, name: `n${idx}`, shapeXml: "", style: { x: 0, y: 0, w: 5, h: 3, fontSize: 14, fontColor: "0", fontName: "", bold: false, align: "l", bulletChar: "" } }) as unknown as PlaceholderInfo;
const content = (idx: string, text: string) => ({ idx, paragraphs: [{ segments: [{ text }] }] });
const slide = (placeholders: ReturnType<typeof content>[]): SlideIR => ({ layout: "auto", placeholders });

describe("unboundContent — 黙って落ちる content を報告する", () => {
  it("body が layout の受け皿より多い → 溢れを未束縛として報告", () => {
    const layout = [ph("title", "0"), ph("body", "1")]; // body 枠は1つ
    const s = slide([content("15", "見出し"), content("1", "本文A"), content("2", "本文B"), content("3", "本文C")]);
    const u = unboundContent(s, layout);
    expect(u.map((x) => x.role)).toEqual(["body", "body"]); // 本文B・本文C が溢れ
    expect(u.map((x) => x.content.idx)).toEqual(["2", "3"]);
  });

  it("title 内容があるのに title 枠が無い → title を未束縛として報告", () => {
    const layout = [ph("body", "1"), ph("body", "2")]; // title 枠なし
    const s = slide([content("15", "見出し"), content("1", "本文")]);
    const u = unboundContent(s, layout);
    expect(u).toHaveLength(1);
    expect(u[0].role).toBe("title");
  });

  it("健全（全 content が束縛）→ 未束縛ゼロ", () => {
    const layout = [ph("title", "0"), ph("body", "1"), ph("body", "2"), ph("body", "3")];
    const s = slide([content("15", "見出し"), content("1", "A"), content("2", "B"), content("3", "C")]);
    expect(unboundContent(s, layout)).toHaveLength(0);
    // routing 不変の確認: bindContentByRole は全4件を配置
    expect(bindContentByRole(s, layout).size).toBe(4);
  });

  it("空欄（クリア済フィールド）は drop ではない → 報告しない", () => {
    const layout = [ph("body", "1")];
    const s = slide([content("1", "本文"), content("2", "   ")]); // idx2 は空白
    const u = unboundContent(s, layout);
    expect(u).toHaveLength(0); // idx1 は束縛・idx2 は空白ゆえ drop 扱いしない
  });
});
