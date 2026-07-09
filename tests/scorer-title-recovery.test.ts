/**
 * scorer-title-recovery.test.ts — F1-②b: scorer 駆動の title 復元（master-intake.md §2 部品1/2）。
 * body 型だが幾何的に明白な見出し（3カラム master の idx-10 見出し等・名前ヒント無し）を
 * scorer が高確信で title と判定 → title role へ昇格 → deck の title が正しくそこへ束縛される。
 * 健全テンプレ（title 既存）では不発＝byte-identical（全既存テストがゲート）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate } from "../src/engine/template-loader";
import { placeholderRole } from "../src/engine/template-catalog";
import { bindContentByRole } from "../src/engine/placeholder-binding";
import type { SlideIR } from "../src/engine/slide-schema";

const fx = (p: string) => resolve(__dirname, "fixtures/templates", p);
const content = (idx: string, text: string) => ({ idx, paragraphs: [{ segments: [{ text }] }] });
const txt = (c: { paragraphs: { segments: { text: string }[] }[] } | undefined) => c?.paragraphs[0].segments[0].text;

describe("scorer title 復元 — body 型見出しを title role へ昇格し正しく束縛", () => {
  it("Dirty 3カラム: idx-10 見出し(body型・名前ヒント無し)が title role になる", async () => {
    const tpl = await loadTemplate(readFileSync(fx("Dirty_Adversarial_TemplateOnly.pptx")));
    const cols = tpl.layouts.find((l) => l.name === "Custom Layout 2")!;
    const heading = cols.placeholders.find((p) => p.idx === "10")!;
    expect(placeholderRole(heading)).toBe("title"); // 昇格された（元は body）

    // deck の title 内容(idx15)が見出し枠(10)へ、本文(1..3)はカラム(11..13)へ
    const s: SlideIR = { layout: "auto", placeholders: [content("15", "見出し"), content("1", "A"), content("2", "B"), content("3", "C")] };
    const bound = bindContentByRole(s, cols.placeholders);
    expect(txt(bound.get("10"))).toBe("見出し"); // title 内容 → 見出し枠（以前は本文が入っていた）
    expect([txt(bound.get("11")), txt(bound.get("12")), txt(bound.get("13"))]).toEqual(["A", "B", "C"]);
  });

  it("Dirty 章扉: body(idx1)\"第3章\" が title role になる（\"03\" は accent で昇格しない）", async () => {
    const tpl = await loadTemplate(readFileSync(fx("Dirty_Adversarial_TemplateOnly.pptx")));
    const sec = tpl.layouts.find((l) => l.name === "カスタム 4")!;
    expect(placeholderRole(sec.placeholders.find((p) => p.idx === "1")!)).toBe("title");
  });

  it("生テキスト title は昇格しない（fillable な placeholder が無い）— Cover は title role を持たない", async () => {
    const tpl = await loadTemplate(readFileSync(fx("Dirty_Adversarial_TemplateOnly.pptx")));
    const cover = tpl.layouts.find((l) => l.name === "1_カスタム レイアウト")!;
    expect(cover.placeholders.some((p) => placeholderRole(p) === "title")).toBe(false); // 昇格対象の枠なし
  });
});
