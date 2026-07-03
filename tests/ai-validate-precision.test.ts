/**
 * ai-validate-precision.test.ts — Wave 1 of the adversarial-hunt fixes: hardening the deterministic
 * validation gate (ai-validate) against the confirmed false-negatives / false-positives.
 *  #5 fullwidth digits: a fact-loss in 全角 numbers was missed; 全角⇄半角 same-value was false-flagged.
 *  #7 body wipe: a condense that keeps only a heading (bullets N→0) slipped through.
 *  #8 language: kana-token English drift missed; digit/emoji-only or acronym JA false-flagged.
 *  #9 titleText: idx0‖idx15 OR held a dropped title as "present" across namespaces.
 */
import { describe, it, expect } from "vitest";
import { validateCondense, validateStructure } from "../src/engine/ai-validate";
import type { SlideIR } from "../src/engine/slide-schema";

const ph = (idx: string, text: string) => ({ idx, paragraphs: [{ segments: [{ text }] }] });
const slide = (s: Partial<SlideIR>): SlideIR => ({ layout: "auto", placeholders: [], ...s });

describe("#5 fullwidth digit normalization", () => {
  it("catches a fact loss written in 全角 digits (was missed)", () => {
    const v = validateCondense("売上は１２３億円で成長", "売上は好調");
    expect(v.hasHard).toBe(true);
    expect(v.violations.some((x) => x.kind === "fact")).toBe(true);
  });
  it("does NOT false-flag a 全角⇄半角 same-value reformat", () => {
    const v = validateCondense("売上は123億円", "売上は１２３億円");
    expect(v.violations.some((x) => x.kind === "fact")).toBe(false);
  });
});

describe("#7 content-wipe detection (condense keeps only a heading)", () => {
  it("flags a condense that drops all bullets to nothing", () => {
    const v = validateCondense("## 概要\n- 顧客満足度の向上\n- 業務効率の改善\n- コスト削減の推進", "## 概要");
    expect(v.hasHard).toBe(true);
  });
  it("does NOT flag a legit merge into one shorter bullet", () => {
    const v = validateCondense("- 顧客満足度の向上\n- 業務効率の改善\n- コスト削減", "- 満足度↑・効率↑・コスト↓");
    expect(v.ok).toBe(true);
  });
  it("does NOT flag a prose merge that keeps the content", () => {
    const v = validateCondense("- 情報共有の遅れ\n- 全体の遅延", "情報共有の遅れが全体遅延を招く");
    expect(v.violations.some((x) => x.detail.includes("箇条書き"))).toBe(false);
  });
});

describe("#8 language heuristic precision", () => {
  it("catches English drift even with a katakana loanword left in (was missed)", () => {
    const v = validateCondense("弊社の新型車は燃費が良い", "Our new car トヨタ has great fuel economy");
    expect(v.violations.some((x) => x.kind === "language")).toBe(true);
  });
  it("does NOT flag a numbers-only condense as a translation", () => {
    const v = validateCondense("測定値の一覧", "42 / 100 / 256");
    expect(v.violations.some((x) => x.kind === "language")).toBe(false);
  });
  it("does NOT flag an acronym-heavy JA condense (KPI改善)", () => {
    const v = validateCondense("KPIを改善する取り組み", "KPI改善");
    expect(v.violations.some((x) => x.kind === "language")).toBe(false);
  });
  it("does NOT flag English staying English with one kanji place-name", () => {
    const v = validateCondense("Our partner is a company", "Partnership with 東京 branch");
    expect(v.violations.some((x) => x.kind === "language")).toBe(false);
  });
  it("still flags a real EN→JA translation", () => {
    const v = validateCondense("The quarterly report", "四半期報告書です");
    expect(v.violations.some((x) => x.kind === "language")).toBe(true);
  });
  it("still flags a real JA→中文 drift", () => {
    const v = validateCondense("弊社の売上は増加", "我们的销售额增长");
    expect(v.violations.some((x) => x.kind === "language")).toBe(true);
  });
});

describe("#9 titleText uses the slide's own namespace (no cross-namespace false-hold)", () => {
  it("flags a dropped content title even when idx0 holds unrelated text", () => {
    const before = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "本当のタイトル"), ph("1", "本文")] });
    const after = slide({ layout: "Content.1Body.Single", placeholders: [ph("0", "脚注ゴミ"), ph("1", "本文")] });
    expect(validateStructure(before, after, "edit").violations.some((x) => x.detail.includes("タイトル"))).toBe(true);
  });
  it("does not false-flag when the content title is preserved", () => {
    const before = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "見出し"), ph("1", "本文")] });
    const after = slide({ layout: "Content.1Body.Single", placeholders: [ph("15", "見出し"), ph("1", "本文2")] });
    expect(validateStructure(before, after, "edit").ok).toBe(true);
  });
});
